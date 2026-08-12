# Atlas infrastructure — reference example.
#
# Provisions the managed services the platform depends on: PostgreSQL, Redis,
# object storage and a search domain. Compute (ECS/EKS) is intentionally left
# out; use the Kubernetes manifests in ../kubernetes, or add an ECS service.

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Configure remote state with locking before using this for anything real.
  # backend "s3" {
  #   bucket         = "atlas-terraform-state"
  #   key            = "atlas/terraform.tfstate"
  #   region         = "ca-central-1"
  #   dynamodb_table = "atlas-terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "atlas"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

locals {
  name = "atlas-${var.environment}"
}

# ---------------------------------------------------------------------------
# PostgreSQL
# ---------------------------------------------------------------------------

resource "random_password" "database" {
  length  = 40
  special = false
}

resource "aws_db_instance" "postgres" {
  identifier     = "${local.name}-postgres"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.database_instance_class

  allocated_storage     = var.database_allocated_storage
  max_allocated_storage = var.database_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "atlas"
  username = "atlas"
  password = random_password.database.result

  # Point-in-time recovery. A backup you have never restored is a hypothesis,
  # so rehearse the restore before relying on this.
  backup_retention_period = var.environment == "production" ? 30 : 7
  backup_window           = "08:00-09:00"
  maintenance_window      = "Sun:09:30-Sun:10:30"

  multi_az                    = var.environment == "production"
  deletion_protection         = var.environment == "production"
  skip_final_snapshot         = var.environment != "production"
  final_snapshot_identifier   = var.environment == "production" ? "${local.name}-final" : null
  auto_minor_version_upgrade  = true
  performance_insights_enabled = var.environment == "production"

  # The generated tsvector column and pg_trgm indexes require no extra
  # parameters, but logging slow queries is worth having from day one.
  parameter_group_name = aws_db_parameter_group.postgres.name

  vpc_security_group_ids = var.database_security_group_ids
  db_subnet_group_name   = var.database_subnet_group_name
}

resource "aws_db_parameter_group" "postgres" {
  name   = "${local.name}-postgres16"
  family = "postgres16"

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }
}

# ---------------------------------------------------------------------------
# Redis — cache, BullMQ queues and distributed locks
# ---------------------------------------------------------------------------

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${local.name}-redis"
  description          = "Atlas cache, job queues and auction settlement locks"

  engine         = "redis"
  engine_version = "7.1"
  node_type      = var.redis_node_type
  port           = 6379

  # Queued jobs and auction locks must survive a node failure, so production
  # runs a replica with automatic failover.
  num_cache_clusters         = var.environment == "production" ? 2 : 1
  automatic_failover_enabled = var.environment == "production"
  multi_az_enabled           = var.environment == "production"

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  # BullMQ jobs must never be evicted under memory pressure.
  parameter_group_name = aws_elasticache_parameter_group.redis.name

  security_group_ids = var.redis_security_group_ids
  subnet_group_name  = var.redis_subnet_group_name
}

resource "aws_elasticache_parameter_group" "redis" {
  name   = "${local.name}-redis7"
  family = "redis7"

  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

# ---------------------------------------------------------------------------
# Object storage — vehicle photos and documents
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "media" {
  bucket = "${local.name}-media"
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration {
    # Versioning is the safety net for an accidental overwrite or delete.
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket = aws_s3_bucket.media.id
  # Objects are served through CloudFront, never directly from the bucket.
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = var.allowed_origins
    max_age_seconds = 3600
  }
}

resource "aws_cloudfront_origin_access_control" "media" {
  name                              = "${local.name}-media-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "media" {
  enabled = true
  comment = "${local.name} media"

  origin {
    domain_name              = aws_s3_bucket.media.bucket_regional_domain_name
    origin_id                = "media"
    origin_access_control_id = aws_cloudfront_origin_access_control.media.id
  }

  default_cache_behavior {
    target_origin_id       = "media"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    # Uploaded objects have generated, immutable names, so they cache hard.
    min_ttl                = 0
    default_ttl            = 86400
    max_ttl                = 31536000

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# ---------------------------------------------------------------------------
# Search — optional. SEARCH_PROVIDER=postgres needs none of this.
# ---------------------------------------------------------------------------

resource "aws_opensearch_domain" "search" {
  count = var.enable_opensearch ? 1 : 0

  domain_name    = "${local.name}-search"
  engine_version = "OpenSearch_2.17"

  cluster_config {
    instance_type          = var.opensearch_instance_type
    instance_count         = var.environment == "production" ? 3 : 1
    zone_awareness_enabled = var.environment == "production"

    dynamic "zone_awareness_config" {
      for_each = var.environment == "production" ? [1] : []
      content {
        availability_zone_count = 3
      }
    }
  }

  ebs_options {
    ebs_enabled = true
    volume_size = var.opensearch_volume_size
    volume_type = "gp3"
  }

  encrypt_at_rest { enabled = true }
  node_to_node_encryption { enabled = true }
  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"
  }
}

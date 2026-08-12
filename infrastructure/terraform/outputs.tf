output "database_url" {
  description = "Connection string for DATABASE_URL. Store it in a secret manager."
  value       = "postgresql://atlas:${random_password.database.result}@${aws_db_instance.postgres.endpoint}/atlas?schema=public"
  sensitive   = true
}

output "redis_url" {
  description = "Connection string for REDIS_URL."
  value       = "rediss://${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"
  sensitive   = true
}

output "s3_bucket" {
  value = aws_s3_bucket.media.id
}

output "s3_public_url" {
  description = "Value for S3_PUBLIC_URL — the CDN in front of the bucket."
  value       = "https://${aws_cloudfront_distribution.media.domain_name}"
}

output "opensearch_node" {
  description = "Value for OPENSEARCH_NODE when search is enabled."
  value       = var.enable_opensearch ? "https://${aws_opensearch_domain.search[0].endpoint}" : null
}

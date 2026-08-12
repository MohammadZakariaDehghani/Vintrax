variable "aws_region" {
  description = "AWS region. Canadian data residency usually means ca-central-1."
  type        = string
  default     = "ca-central-1"
}

variable "environment" {
  description = "Environment name. `production` turns on multi-AZ, deletion protection and longer backups."
  type        = string
  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "environment must be development, staging or production."
  }
}

variable "allowed_origins" {
  description = "Origins permitted to load media from the CDN."
  type        = list(string)
  default     = ["https://atlas.example.com"]
}

# --- Database ---
variable "database_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "database_allocated_storage" {
  type    = number
  default = 50
}

variable "database_max_allocated_storage" {
  description = "Upper bound for storage autoscaling."
  type        = number
  default     = 500
}

variable "database_subnet_group_name" {
  description = "Subnet group placing the database in private subnets."
  type        = string
}

variable "database_security_group_ids" {
  type = list(string)
}

# --- Redis ---
variable "redis_node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "redis_subnet_group_name" {
  type = string
}

variable "redis_security_group_ids" {
  type = list(string)
}

# --- Search ---
variable "enable_opensearch" {
  description = "Provision an OpenSearch domain. Not needed when SEARCH_PROVIDER=postgres."
  type        = bool
  default     = false
}

variable "opensearch_instance_type" {
  type    = string
  default = "t3.small.search"
}

variable "opensearch_volume_size" {
  type    = number
  default = 20
}

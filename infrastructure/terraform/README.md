# Terraform examples

Reference infrastructure for running Vintrax on AWS. **These are examples, not a
production module** — they show the shape of the infrastructure and the
decisions that matter, and deliberately omit VPC/networking, which varies too
much between organisations to guess at.

Before using them: review every `variable` default, add remote state with
locking, and put the database in private subnets.

```bash
terraform init
terraform plan -var-file=environments/production.tfvars
```

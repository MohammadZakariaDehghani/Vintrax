# Vintrax Production Migration Plan
## Sep 28 - Oct 16, 2026 | 3 hours/day (2pm-5pm)
                         GitHub
                           │
                    ┌──────▼──────┐
                    │   GitHub    │
                    │   Actions   │
                    └──────┬──────┘
                           │
              ┌────────────▼────────────┐
              │      Terraform          │
              │ Infrastructure as Code  │
              └────────────┬────────────┘
                           │
                    Google Cloud
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
      VPC              GKE Cluster       Cloud DNS
        │                  │
        │          ┌───────┴────────┐
        │          │                │
        │        Frontend          Backend
        │        Web/Mobile        API
        │          │                │
        │          └───────┬────────┘
        │                  │
        │          ┌───────▼────────┐
        │          │   PostgreSQL    │
        │          │ Cloud SQL       │
        │          └────────────────┘
        │
        ├── Load Balancer
        ├── Firewall
        └── NAT
---

## Executive Summary
Complete migration of Vintrax from repository to production GCP environment using:
- **Infrastructure**: Terraform IaC on Google Cloud
- **Orchestration**: Google Kubernetes Engine (GKE)
- **Database**: Cloud SQL (PostgreSQL)
- **CI/CD**: GitHub Actions
- **Networking**: Load Balancer, Firewall, NAT, Cloud DNS

**Total Timeline**: 13 working days | 39 hours total

---

## Phase 1: Preparation & Prerequisites
**Duration**: Sep 30 - Oct 1 (2 days)

### Day 1: Sep 30 (Monday) - Kick-off & Environment Setup
**Tasks** (3 hours):
- [ ] Review full architecture & migration plan with team
- [ ] Validate GitHub Actions runner setup
- [ ] Create GCP Project (if not exists)
- [ ] Enable required APIs:
  - [ ] Google Kubernetes Engine API
  - [ ] Cloud SQL Admin API
  - [ ] Compute Engine API
  - [ ] Cloud DNS API
  - [ ] Cloud Resource Manager API
  - [ ] Service Networking API
  - [ ] Cloud Build API
- [ ] Setup service accounts & IAM roles
- [ ] Generate GCP credentials for GitHub Actions
- [ ] Configure GitHub Secrets (GCP_PROJECT_ID, GCP_SA_KEY, etc.)
- [ ] Create project documentation/runbook

**Dependencies**:
- GCP account with billing enabled
- GitHub repository access with admin permissions
- Terraform >= 1.0 installed locally

---

### Day 2: Oct 1 (Tuesday) - Terraform & Repository Prep
**Tasks** (3 hours):
- [ ] Initialize Terraform project structure
- [ ] Validate terraform syntax & formatting
- [ ] Setup Terraform state backend (Cloud Storage)
- [ ] Test terraform init/plan with GCP credentials
- [ ] Review all Terraform modules:
  - [ ] VPC configuration
  - [ ] GKE cluster variables
  - [ ] Cloud SQL variables
  - [ ] Load Balancer configuration
  - [ ] Firewall rules
  - [ ] NAT configuration
  - [ ] Cloud DNS variables
- [ ] Document all required terraform.tfvars values
- [ ] Create backend.tf for state management
- [ ] Setup Terraform validation in CI/CD

**Deliverables**:
- ✅ Working terraform directory structure
- ✅ GitHub Secrets configured
- ✅ terraform plan validated

---

## Phase 2: Infrastructure Setup with Terraform
**Duration**: Oct 2 - Oct 4 (3 days)

### Day 3: Oct 2 (Wednesday) - VPC & Network Foundation
**Tasks** (3 hours):
- [ ] Run terraform init
- [ ] Create/update VPC network
- [ ] Configure subnets (app, db, secondary ranges for GKE)
- [ ] Enable Cloud NAT
- [ ] Setup Cloud Router
- [ ] Create firewall ingress rules:
  - [ ] Allow HTTP (80)
  - [ ] Allow HTTPS (443)
  - [ ] Allow internal GKE communication
  - [ ] Allow Cloud SQL access
- [ ] Verify network topology with gcloud commands
- [ ] Test terraform destroy/recreate (safety check)

**Validation**:
```bash
gcloud compute networks list
gcloud compute networks subnets list
gcloud compute firewall-rules list
```

---

### Day 4: Oct 3 (Thursday) - GKE Cluster Deployment
**Tasks** (3 hours):
- [ ] Run terraform apply for VPC (confirmed)
- [ ] Terraform plan for GKE cluster
- [ ] Create GKE cluster:
  - [ ] Standard cluster configuration
  - [ ] Primary node pool setup
  - [ ] RBAC enabled
  - [ ] Network policies enabled
  - [ ] Logging & Monitoring enabled
  - [ ] Workload Identity enabled
- [ ] Wait for cluster creation (~10-15 min)
- [ ] Configure kubectl context
- [ ] Verify cluster connectivity:
  ```bash
  kubectl cluster-info
  kubectl get nodes
  ```
- [ ] Create system namespaces
- [ ] Setup RBAC service accounts

**Testing**:
- [ ] kubectl can connect to cluster
- [ ] Nodes are ready
- [ ] Services can be deployed

---

### Day 5: Oct 4 (Friday) - DNS & Load Balancer Setup
**Tasks** (3 hours):
- [ ] Terraform plan for Cloud DNS
- [ ] Create Cloud DNS zone
- [ ] Configure DNS records:
  - [ ] A record for domain → Load Balancer IP
  - [ ] CNAME records if needed
- [ ] Setup Global Load Balancer:
  - [ ] Create backend services
  - [ ] Configure health checks
  - [ ] Setup URL maps
  - [ ] Create target HTTPS proxy
  - [ ] Reserve static IP address
  - [ ] Configure SSL certificate (self-signed or real)
- [ ] Test DNS resolution:
  ```bash
  nslookup your-domain.com
  dig your-domain.com
  ```
- [ ] Verify load balancer status
- [ ] Create firewall rules for load balancer

**Infrastructure Status**:
- ✅ VPC with proper networking
- ✅ GKE cluster running
- ✅ Load Balancer configured
- ✅ DNS pointing to load balancer

---

## Phase 3: Database Setup & Configuration
**Duration**: Oct 7 - Oct 8 (2 days)

### Day 6: Oct 7 (Monday) - Cloud SQL Instance
**Tasks** (3 hours):
- [ ] Terraform plan for Cloud SQL
- [ ] Create Cloud SQL PostgreSQL instance:
  - [ ] Machine type: db-f1-micro or larger
  - [ ] High availability (HA) enabled
  - [ ] Automated backups configured (daily)
  - [ ] Point-in-time recovery enabled
  - [ ] Private IP (VPC peering)
  - [ ] Public IP (if needed for testing only)
- [ ] Wait for instance creation (~5-10 min)
- [ ] Create root user password (store in Secret Manager)
- [ ] Create database users:
  - [ ] Application user (vintrax_app)
  - [ ] Read-only user (vintrax_readonly)
- [ ] Setup Cloud SQL Proxy on client
- [ ] Test database connectivity:
  ```bash
  gcloud sql connect INSTANCE_NAME --user=postgres
  ```

**Prerequisites**:
- Database schema/migration scripts ready
- Connection pooling configured
- Backup strategy documented

---

### Day 7: Oct 8 (Tuesday) - Database Initialization
**Tasks** (3 hours):
- [ ] Run database migration scripts
- [ ] Create all tables & schemas
- [ ] Setup indexes for performance
- [ ] Configure connection pooling (if needed)
- [ ] Create views & stored procedures
- [ ] Seed initial data (if required)
- [ ] Verify schema:
  ```bash
  psql -h CLOUD_SQL_IP -U vintrax_app -d vintrax -c "\dt"
  ```
- [ ] Test application user permissions
- [ ] Setup automated backups
- [ ] Create database backup snapshot
- [ ] Document backup/restore procedures
- [ ] Setup monitoring for Cloud SQL:
  - [ ] CPU usage alerts
  - [ ] Storage alerts
  - [ ] Connection alerts

**Database Status**:
- ✅ Cloud SQL instance running
- ✅ All schemas created
- ✅ Users configured
- ✅ Backups automated
- ✅ Monitoring enabled

---

## Phase 4: Backend Deployment
**Duration**: Oct 9 - Oct 11 (3 days)

### Day 8: Oct 9 (Wednesday) - Backend Docker & Container Registry
**Tasks** (3 hours):
- [ ] Review Dockerfile for backend service
- [ ] Ensure Dockerfile is optimized:
  - [ ] Multi-stage build (if applicable)
  - [ ] Latest base image
  - [ ] Security best practices
- [ ] Create Google Container Registry (GCR) repository
- [ ] Configure Docker authentication with gcloud
- [ ] Build Docker image locally:
  ```bash
  docker build -t gcr.io/PROJECT_ID/vintrax-backend:latest .
  ```
- [ ] Push to GCR:
  ```bash
  docker push gcr.io/PROJECT_ID/vintrax-backend:latest
  ```
- [ ] Create image vulnerability scanning policy
- [ ] Verify image in GCR console
- [ ] Create Kubernetes deployment manifest (backend):
  - [ ] Service account
  - [ ] Deployment spec
  - [ ] Resource requests/limits
  - [ ] Environment variables
  - [ ] ConfigMaps for configuration
  - [ ] Secrets for sensitive data

**Checklist**:
- ✅ Docker image built & pushed
- ✅ Image scanned for vulnerabilities
- ✅ Kubernetes manifests prepared

---

### Day 9: Oct 10 (Thursday) - Backend Kubernetes Deployment
**Tasks** (3 hours):
- [ ] Create Kubernetes namespaces:
  - [ ] vintrax-backend (production)
  - [ ] vintrax-backend-staging (for testing)
- [ ] Setup ConfigMaps:
  ```bash
  kubectl create configmap backend-config --from-file=config/ -n vintrax-backend
  ```
- [ ] Create Secrets in Kubernetes:
  - [ ] Database credentials
  - [ ] API keys
  - [ ] JWT secrets
  - [ ] Store in Secret Manager & reference
- [ ] Deploy backend to staging first:
  ```bash
  kubectl apply -f backend-deployment.yaml -n vintrax-backend-staging
  ```
- [ ] Verify deployment:
  ```bash
  kubectl get pods -n vintrax-backend-staging
  kubectl logs deployment/vintrax-backend -n vintrax-backend-staging
  ```
- [ ] Test backend connectivity:
  - [ ] Port forward test
  - [ ] API endpoint tests
  - [ ] Database connection tests
- [ ] Check resource usage
- [ ] Setup horizontal pod autoscaler (HPA)
- [ ] Create service endpoint:
  ```bash
  kubectl expose deployment vintrax-backend --type=ClusterIP -n vintrax-backend-staging
  ```

**Testing**:
- [ ] Backend pods are running
- [ ] Logs show no errors
- [ ] Database connectivity working
- [ ] API endpoints responding

---

### Day 10: Oct 11 (Friday) - Backend Production Deployment
**Tasks** (3 hours):
- [ ] Conduct staging tests:
  - [ ] API integration tests
  - [ ] Database transaction tests
  - [ ] Error handling tests
  - [ ] Load testing (if applicable)
- [ ] Deploy to production namespace:
  ```bash
  kubectl apply -f backend-deployment.yaml -n vintrax-backend
  ```
- [ ] Verify production deployment:
  - [ ] Pods are running
  - [ ] Resource limits applied
  - [ ] Logging working
- [ ] Setup backend service for Load Balancer
- [ ] Configure backend service health checks
- [ ] Update Load Balancer routing to backend service
- [ ] Verify backend through load balancer
- [ ] Monitor backend metrics:
  - [ ] Pod CPU/Memory
  - [ ] Request latency
  - [ ] Error rates
- [ ] Setup alerting for backend health
- [ ] Document backend deployment procedures

**Production Status**:
- ✅ Backend deployed to production
- ✅ Load Balancer routing to backend
- ✅ Monitoring & alerts active
- ✅ Health checks passing

---

## Phase 5: Frontend Deployment
**Duration**: Oct 14 - Oct 15 (2 days)

### Day 11: Oct 14 (Monday) - Frontend Build & Deployment Prep
**Tasks** (3 hours):
- [ ] Review frontend code & build configuration
- [ ] Build Docker image for frontend:
  - [ ] Ensure nginx/web server config included
  - [ ] Configure for production URLs
  - [ ] Optimize assets (minification, etc.)
- [ ] Build Docker image:
  ```bash
  docker build -t gcr.io/PROJECT_ID/vintrax-frontend:latest .
  ```
- [ ] Push to GCR:
  ```bash
  docker push gcr.io/PROJECT_ID/vintrax-frontend:latest
  ```
- [ ] Create Kubernetes deployment for frontend
- [ ] Configure environment variables for frontend:
  - [ ] API_URL pointing to backend service
  - [ ] Domain/host configuration
  - [ ] Analytics keys (if applicable)
- [ ] Deploy to staging:
  ```bash
  kubectl apply -f frontend-deployment.yaml -n vintrax-frontend-staging
  ```
- [ ] Verify frontend is accessible via port-forward

**Frontend Checklist**:
- ✅ Docker image built & scanned
- ✅ Kubernetes manifests ready
- ✅ Configuration set for production

---

### Day 12: Oct 15 (Tuesday) - Frontend Production Deployment
**Tasks** (3 hours):
- [ ] Create production namespace for frontend
- [ ] Deploy frontend to production:
  ```bash
  kubectl apply -f frontend-deployment.yaml -n vintrax-frontend
  ```
- [ ] Verify frontend deployment
- [ ] Create frontend service (ClusterIP)
- [ ] Configure Load Balancer backend service for frontend
- [ ] Update URL maps in Load Balancer:
  - [ ] Route / → frontend service
  - [ ] Route /api/* → backend service (if applicable)
- [ ] Test end-to-end connectivity:
  - [ ] Access frontend through load balancer domain
  - [ ] Verify frontend can call backend APIs
  - [ ] Check CORS configuration
- [ ] Verify SSL/TLS:
  - [ ] HTTPS working
  - [ ] Certificate valid
  - [ ] No mixed content warnings
- [ ] Performance testing:
  - [ ] Page load times
  - [ ] Asset serving
  - [ ] API call latency
- [ ] Setup frontend monitoring
- [ ] Create alerts for frontend health

**Production Status**:
- ✅ Frontend deployed & accessible
- ✅ Frontend-backend communication working
- ✅ HTTPS enabled
- ✅ Performance acceptable

---

## Phase 6: Security, Monitoring & Go-Live
**Duration**: Oct 16 (1 day)

### Day 13: Oct 16 (Wednesday) - Security, Monitoring & Final Verification
**Tasks** (3 hours):
- [ ] Security hardening:
  - [ ] Review firewall rules (least privilege)
  - [ ] Verify network policies in GKE
  - [ ] Check RBAC permissions
  - [ ] Scan container images
  - [ ] Verify secrets not in logs
  - [ ] Review Cloud SQL encryption (at-rest & in-transit)
  - [ ] Enable audit logging
- [ ] Setup comprehensive monitoring:
  - [ ] Google Cloud Monitoring dashboards
  - [ ] Application-level metrics
  - [ ] Frontend performance metrics
  - [ ] Backend error rates
  - [ ] Database query performance
  - [ ] Infrastructure health
- [ ] Setup alerting:
  - [ ] High error rates
  - [ ] Resource exhaustion
  - [ ] Latency spikes
  - [ ] Pod crashes
  - [ ] Database connectivity issues
- [ ] Backup verification:
  - [ ] Test Cloud SQL backup restore
  - [ ] Verify backup automation
  - [ ] Document RTO/RPO
- [ ] Documentation completion:
  - [ ] Runbooks for operations
  - [ ] Incident response procedures
  - [ ] Scaling procedures
  - [ ] Troubleshooting guide
- [ ] Final end-to-end testing:
  - [ ] User workflows
  - [ ] Critical paths
  - [ ] Error scenarios
- [ ] Stakeholder signoff
- [ ] Monitor for 1 hour post-deployment

**Final Verification**:
- ✅ All services running in production
- ✅ Monitoring & alerts configured
- ✅ Backups working
- ✅ Security baseline met
- ✅ Documentation complete
- ✅ Team trained on operations

---

## Critical Dependencies & Prerequisites

### Pre-Migration Requirements
```
✓ GitHub Repository
  - Terraform code committed & tested
  - Dockerfiles for backend & frontend
  - Kubernetes manifests
  - CI/CD workflows configured

✓ Google Cloud
  - GCP Project created
  - Billing enabled
  - APIs enabled
  - Service accounts configured

✓ Domain & SSL
  - Domain registered
  - SSL certificate ready or Let's Encrypt configured
  - DNS provider accessible

✓ Code & Database
  - Source code latest version
  - Database migration scripts ready
  - Environment configuration documented

✓ Team Preparation
  - Terraform knowledge
  - Kubernetes basics
  - GCP console familiarity
  - On-call rotation established
```

### Application Stack
```
Deployment Stack:
- Terraform >= 1.0
- Google Cloud SDK (gcloud)
- kubectl >= 1.25
- Docker (local build/test)
- PostgreSQL client tools (psql)

Infrastructure Services:
- Google Kubernetes Engine (GKE)
- Cloud SQL (PostgreSQL)
- Google Cloud Load Balancer
- Cloud DNS
- Cloud Compute (VPC, Firewall, NAT)
- Cloud Storage (Terraform state)
- Google Container Registry (GCR)

Monitoring:
- Google Cloud Logging
- Google Cloud Monitoring
- Kubernetes Events & Metrics
```

---

## Risk Mitigation

### High-Risk Areas
| Risk | Mitigation |
|------|-----------|
| Terraform state corruption | Use remote state in GCS with versioning & locking |
| Database migration failures | Test migrations on staging; maintain backup before production |
| Network configuration errors | Use terraform plan extensively; separate VPC/compute creation |
| Secret exposure | Use Google Secret Manager; rotate credentials post-migration |
| Performance degradation | Load test before cutover; scale resources if needed |
| Certificate/DNS issues | Test DNS resolution early; have fallback IPs ready |

### Rollback Procedures
- **Day 1-2**: Recreate infrastructure with terraform destroy/apply
- **Day 3-4**: Network config rollback via terraform
- **Day 5**: Full cluster recreate from GCS terraform state
- **Day 6-8**: Database rollback to automated backup
- **Day 9+**: Service rollback by reverting Kubernetes manifests

---

## Success Criteria

✅ **Infrastructure**:
- VPC, GKE, Cloud SQL all deployed via Terraform
- Load Balancer routing traffic correctly
- DNS resolving to load balancer

✅ **Services**:
- Backend API responding
- Frontend accessible via domain
- Frontend-Backend communication working

✅ **Operations**:
- Monitoring dashboards active
- Alerting configured & tested
- Backups automated & verified

✅ **Security**:
- All traffic over HTTPS
- Network policies enforced
- Secrets managed securely

✅ **Performance**:
- Frontend load time < 3s
- API response time < 500ms
- Database queries optimal

---

## Contact & Escalation
- **Project Lead**: [Your Name/Team]
- **Terraform Expert**: [Contact]
- **GCP Admin**: [Contact]
- **Database Admin**: [Contact]
- **Emergency Contact**: [24/7 escalation]

---

**Last Updated**: 2026-09-23
**Next Review**: Post-migration day 1

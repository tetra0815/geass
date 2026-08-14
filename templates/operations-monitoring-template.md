# Metrics & Alert Definition Template

**Target**: `docs/operations/monitoring.md`

## Metrics & Alerts Definition Table

| Metric | Description | Data Source | Threshold/Condition | Severity | Notification Channel |
|---|---|---|---|---|---|
| API 5xx error rate | Share of 5xx responses over a 5-minute window | ALB/API logs | > 1% sustained for 5 min | Critical | PagerDuty |
| API p99 latency | p99 response time over a 5-minute window | APM | > 1000ms sustained for 10 min | Warning | Slack `#alerts` |
| DB CPU utilization | CPU on the primary DB instance | CloudWatch | > 80% sustained for 15 min | Warning | Slack `#alerts` |
| DLQ message count | Number of messages stuck in the Dead Letter Queue | CloudWatch | > 0 sustained for 5 min | Critical | PagerDuty |
| Disk utilization | Disk usage on each instance | CloudWatch | > 85% | Warning | Slack `#alerts` |

## Severity Definitions

| Severity | Meaning | Expected Response Time |
|---|---|---|
| Critical | Risk of service outage / data loss | Immediate (page on-call) |
| Warning | An early sign that will worsen if left unaddressed | Address within business hours |
| Info | Record only, no immediate action needed | Reviewed during periodic review |

## Dashboard Composition

| Dashboard | Purpose | Key Panels |
|---|---|---|
| Service overview | The first thing on-call checks for the big picture | Error rate, latency, traffic, resource utilization |
| (Feature name) detail | Deep dive into a specific feature | (List the relevant metrics) |

## Design Notes

- Document that thresholds are initial values and should be revisited once a real operating baseline is established
- To avoid alert fatigue (over-triggering), document a policy that Critical is reserved for things requiring immediate human response
- Updating this table must be mandatory whenever a new metric/alert is added

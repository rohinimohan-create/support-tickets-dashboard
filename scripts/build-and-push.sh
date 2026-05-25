#!/bin/bash
set -e

# Find our current git revision and if not found then
# default to "local" as the container tag
if [[ ! -z "${GITHUB_SHA}" ]]; then
    # Running with GHA Runners
    GIT_REVISION="${GITHUB_SHA:-local}"
else
    # Running with Yamato
    GIT_REVISION="${GIT_REVISION:-local}"
fi

# Image names must follow the namespace-prefixed scheme:
#   europe-docker.pkg.dev/unity-cds-services-prd/ds-docker/csops-ops-csops-tickets-test-dashboard/support-tickets-dashboard:tag

# Build the application image
docker build --platform linux/amd64 -t europe-docker.pkg.dev/unity-cds-services-prd/ds-docker/csops-ops-csops-tickets-test-dashboard/support-tickets-dashboard:${GIT_REVISION:0:8} -f docker/support-tickets-dashboard.Dockerfile .

# Push the image to the Google Container Registry
docker push europe-docker.pkg.dev/unity-cds-services-prd/ds-docker/csops-ops-csops-tickets-test-dashboard/support-tickets-dashboard:${GIT_REVISION:0:8}
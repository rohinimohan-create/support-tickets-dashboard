#!/bin/bash

# Exit script immediately on first error
set -e

# Check the installed version. It's a good idea to confirm that you're on the latest released version of tessen here: https://github.com/Unity-Technologies/tessen/releases
# ensure latest version of tessen

# Find our current git revision and if not found then
# default to "local" as the container tag
if [[ ! -z "${GITHUB_SHA}" ]]; then
    # Running with GHA Runners
    GIT_REVISION="${GITHUB_SHA:-local}"
else
    # Running with Yamato
    GIT_REVISION="${GIT_REVISION:-local}"
fi

CLUSTER="${CLUSTER:-test}"  # set "test" if no cluster found
COMMAND="${COMMAND:-up}"    # set "up" if no command found, can be used to set "diff" for creating a diff in a PR

# Only update tessen if git revision is not defaulted to "local"
if [[ "$GIT_REVISION" != "local" ]]; then
    if [[ "$OSTYPE" == "linux-gnu" ]]; then
        sudo apt update
        sudo apt install -y tessen
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        brew update
        brew outdated | grep -q tessen && brew upgrade tessen
    fi
fi

# Tessen reads the docker-compose file and deploys it to kubernetes in Google Cloud
#
# -k CLUSTER                          Sets the cluster: test, stg, prd, prd-usc1
# -i support-tickets-dashboard=IMAGE:TAG            Overrides the container image
# -E VAR=VALUE                        Passes along environment variables to the container being deployed, don't use this to set secrets use the 'tessen namespace secrets' command instead
#
# NOTE: The image name must follow the namespace-prefixed scheme:
#   europe-docker.pkg.dev/unity-cds-services-prd/ds-docker/csops-ops-csops-tickets-test-dashboard/support-tickets-dashboard:tag
tessen -k=$CLUSTER \
    -i support-tickets-dashboard=europe-docker.pkg.dev/unity-cds-services-prd/ds-docker/csops-ops-csops-tickets-test-dashboard/support-tickets-dashboard:${GIT_REVISION:0:8} \
    deployment $COMMAND

# Gets the status of the deployment
tessen -k=$CLUSTER status
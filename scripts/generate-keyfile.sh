#!/bin/bash
# Generate MongoDB keyfile for replica set authentication
openssl rand -base64 756 > mongo-keyfile
chmod 400 mongo-keyfile
chown 999:999 mongo-keyfile

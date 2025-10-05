#!/bin/bash
# Wait for MongoDB to be ready
echo "Waiting for MongoDB to be ready..."
until mongosh --quiet --eval "db.adminCommand('ping')" > /dev/null 2>&1; do
  sleep 1
done

# Check if replica set is already initialized
RS_STATUS=$(mongosh --quiet --eval "try { rs.status().ok } catch(e) { 0 }")

if [ "$RS_STATUS" != "1" ]; then
  echo "Initializing replica set..."
  # Use localhost instead of mongodb for single-node replica set
  mongosh --quiet --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]})"
  echo "Replica set initialized successfully!"
else
  echo "Replica set already initialized"
fi

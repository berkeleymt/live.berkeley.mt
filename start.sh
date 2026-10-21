#!/bin/sh
# Runs the room-lookup API and the staff editor next to nginx. The token file lives on the data
# volume; the API keeps polling for it, so it can appear after start.
python3 /app/rooms_api.py &
python3 /app/admin.py &
exec nginx -g 'daemon off;'

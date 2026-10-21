#!/bin/sh
# Runs the room-lookup API next to nginx. The token file lives on the data
# volume; the API keeps polling for it, so it can appear after start.
python3 /app/rooms_api.py &
exec nginx -g 'daemon off;'

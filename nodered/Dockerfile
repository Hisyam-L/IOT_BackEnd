FROM nodered/node-red:3.1

# Node kustom (WebSocket ber-JWT) + driver PostgreSQL, dipasang ke /data
COPY --chown=node-red:node-red node/ /tmp/daylight-ws/
RUN cd /data \
 && npm install --no-audit --no-fund --omit=dev --install-links /tmp/daylight-ws pg@8 \
 && rm -rf /tmp/daylight-ws

COPY --chown=node-red:node-red settings.js flows.json /data/

# EcoPantry camera (AI Thinker ESP32-CAM)

Serves a live MJPEG stream at `http://<camera-ip>:81/stream` on the local WiFi. It talks to nothing else
and never to the database. Not yet connected to the backend: the portal's **Camera** page just shows
the stream in the browser.

Setup: `cp include/secrets.h.example include/secrets.h`, fill in WiFi, `pio run -t upload`, open the serial
monitor and read the IP. Enter that IP on the portal's Camera page.

Limits: the stream has no login, so keep the camera on a trusted network. A browser on the HTTPS site may block
an `http://` stream (mixed content); the page links to open it directly, or allow "insecure content" for the site.

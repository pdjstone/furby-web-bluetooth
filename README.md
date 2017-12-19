# FurBLE - Furby Connect Web Bluetooth Demo
Use Web Bluetooth to control your Furby Connect. Tested with Chrome for Android.

## [Live Demo](https://pdjstone.github.io/furby-web-bluetooth/furble.html) 

### Working
- Connect to / disconnect from Furby
- Send basic commands (e.g. actions, set antenna colour)
- Send custom action numbers (see [list of action sequences](https://github.com/Jeija/bluefluff/blob/master/doc/actions.md))
- Upload and activate DLC files

### TODO
- Buttons for more actions
- Decode and display Furby state (e.g. antenna joystick, body sensors etc..)
 - Test if this works on iOS with [WebBLE](https://itunes.apple.com/us/app/webble/id1193531073?mt=8)

## Troubleshooting tips
WebBluetooth in Chrome for Android can be a bit buggy occasionally. If the Furby doesn't show up in the list when you try to connect, try quitting Chrome, then disable and re-enable bluetooth on your phone.

Make sure the batteries in your Furby aren't running low. This can cause the Furby to misbehave in odds ways, including going to sleep unexpectedly.

If your Furby appears to be rejecting connections, try switching it off and on again. Do this by pushing the antenna down for ~5 seconds until the Furby goes to sleep, then waking it up again. Note that putting on the sleep mask seems to put the Furby into standby without actually resetting anything.

If nothing else is working, you can reset the Furby (and clear the DLC storage area) by following these steps:
1. Wake Furby up
2. Hold Furby upside down
3. Hold down the Furby's tongue
4. Pull Furby's tail until the eyes go dark (~10 seconds)
5. You should hear a couple of quiet pops from the speaker as it resets

## Development and Debugging

I used the following setup to develop/debug this:
- Serve the repo from a local HTTP server (e.g. run python3 -m http.server 8000)
- Use Chrome's [remote debugging](https://developers.google.com/web/tools/chrome-devtools/remote-debugging/) feature to forward port 8000 to your Android phone
- Load localhost:8000 in Chrome on your phone
- Use the remote Javascript console in desktop Chrome to debug

## Further Reading
- Reverse Engineering the Furby Connect: https://www.contextis.com/blog/dont-feed-them-after-midnight-reverse-engineering-the-furby-connect
- Furby DLC Python library: https://github.com/ctxis/Furby
- Bluefluff project: https://github.com/Jeija/bluefluff
- Furbhax project: https://github.com/swarley7/furbhax
- CloudPets Web Bluetooth: https://github.com/pdjstone/cloudpets-web-bluetooth

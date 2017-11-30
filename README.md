# FurBLE - Furby Connect Web Bluetooth Demo
Use Web Bluetooth to control your Furby Connect. Tested with Chrome for Android.

### Working
- Connect to / disconnect from Furby
- Send basic commands (e.g. actions, set antenna colour)

### Still TODO
- Get DLC upload working

## Troubleshooting FAQ

WebBluetooth in Chrome for Android can be a bit buggy occasionally. If the Furby doesn't show up in the list when you try to connect, try quitting Chrome, then disable and re-enable bluetooth on your phone.

Make sure the batteries in your Furby aren't running low. This can cause the Furby to misbehave in odds ways, including going to sleep unexpectedly.

If nothing else is working, you can reset the Furby by following these steps:
1. Wake Furby up
2. Hold Furby updside down
3. Hold down the Furby's tongue
4. Pull Furby's tail until it switches off (~5 seconds)

## Further Reading
- Reverse Engineering the Furby Connect: https://www.contextis.com/blog/dont-feed-them-after-midnight-reverse-engineering-the-furby-connect
- Furby DLC Python library: https://github.com/ctxis/Furby
- Bluefluff project: https://github.com/Jeija/bluefluff
- Furbhax project: https://github.com/swarley7/furbhax
- CloudPets Web Bluetooth: https://github.com/pdjstone/cloudpets-web-bluetooth

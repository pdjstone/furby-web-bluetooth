# FurBLE - Furby Web Bluetooth Demo
Use Web Bluetooth to control your Furby Connect! Tested with Chrome for Android.

## [Try it out](https://pdjstone.github.io/furby-web-bluetooth/furble.html)  or read [our blog](https://www.contextis.com/blog/dont-feed-them-after-midnight-reverse-engineering-the-furby-connect)

<img src="images/furby1.jpg" width="500">

### Working:
- Connect to / disconnect from Furby
- Send basic commands (e.g. actions, set antenna colour)
- Send custom action numbers (see [list of action sequences](https://github.com/Jeija/bluefluff/blob/master/doc/actions.md))
- Upload and activate DLC files
- Decode and display Furby state (antenna joystick, body sensors, orientation)

### TODO:
- Customisable action buttons
- UI for managing DLC slots
- Test if this works on iOS with [WebBLE](https://itunes.apple.com/us/app/webble/id1193531073?mt=8)
- Visualise Furby orientation 

Pull requests are welcome!

## FAQ

#### Why did you make this?
I wanted to build on the excellent [bluefluff](https://github.com/Jeija/bluefluff) project and make something really easy to use - just visit the [demo page](https://pdjstone.github.io/furby-web-bluetooth/furble.html) with your Android phone and connect to your Furby.

#### Does it work with Chrome for Linux/Windows/Mac or other browsers?
Web Bluetooth is a Chrome-only thing at the moment. Mac is apparently supported, but I've not tested it. It should also work on most Chromebooks. See the Web Bluetooth [implementation status](https://github.com/WebBluetoothCG/web-bluetooth/blob/master/implementation-status.md) page.
 
#### How do I make Furby say different things?
Take a look at the built-in [action list](https://github.com/Jeija/bluefluff/blob/master/doc/actions.md#list). Look up the four numbers for a particular action and put them in the 'action sequences' section of FurBLE.

#### I've successfully uploaded a DLC file, but the sounds/graphics seem corrupted
Try doing the "pull tail/push tongue" reset described below before uploading a new DLC file.

#### Furby keeps disconnecting / going to sleep
The batteries may be low, try replacing them. Furby eats through batteries fairly rapidly. If you're spending extended period with FurBLE connected to a Furby, turn off the eyes (using the button in the Debug section) to save battery.

#### Can I create my own DLC with custom animations/sounds?
Yes, though it's not straightforward currently. Make sure you read about the [DLC format](https://www.contextis.com/blog/dont-feed-them-after-midnight-reverse-engineering-the-furby-connect) and take a look at the ```demo.py``` script in our [Furby Python tools](https://github.com/ctxis/furby) repo for an example of how to do this. 

## Troubleshooting tips
Web Bluetooth in Chrome for Android can be a bit buggy occasionally. If the Furby doesn't show up in the list when you try to connect, try quitting Chrome, then disable and re-enable bluetooth on your phone.

Make sure the batteries in your Furby aren't running low. This can cause the Furby to misbehave in odds ways, including going to sleep unexpectedly.

If your Furby appears to be rejecting connections, try switching it off and on again. Do this by pushing the antenna down for ~5 seconds until the Furby goes to sleep, then waking it up again. Note that attaching the sleep mask seems to put the Furby into standby without actually restarting the CPU.

You can fully reset the Furby (and clear the DLC storage area) by following these steps:
1. Wake Furby up
2. Hold Furby upside down
3. Hold down Furby's tongue
4. Pull Furby's tail until the eyes go dark (~10 seconds)
5. You should hear a couple of quiet pops from the speaker as it resets


## Development and Debugging

I used the following setup to develop/debug this:
- Serve the repo from a local HTTP server (e.g. run python3 -m http.server 8000)
- Use Chrome's [remote debugging](https://developers.google.com/web/tools/chrome-devtools/remote-debugging/) feature to forward port 8000 to your Android phone
- Load localhost:8000 in Chrome on your phone
- Use the remote Javascript console in desktop Chrome to debug

## Thanks
Thanks to [Jeija](https://github.com/Jeija) for his work documenting the Furby Bluetooth protocol, and to [@L0C4RD](https://twitter.com/L0C4RD) for his help dissecting the DLC format. Also thanks to my work colleagues and to my wife whose patience has been pushed to the limit by noisy, farting Furbies that won't shut the *#$& up while I've been trying to debug my code.

## Further Reading
- Reverse Engineering the Furby Connect: https://www.contextis.com/blog/dont-feed-them-after-midnight-reverse-engineering-the-furby-connect
- Furby DLC Python library: https://github.com/ctxis/Furby
- Bluefluff project: https://github.com/Jeija/bluefluff
- Furbhax project: https://github.com/swarley7/furbhax
- CloudPets Web Bluetooth: https://github.com/pdjstone/cloudpets-web-bluetooth

# Wacom-STU-WebHID
JavaScript library to use the Wacom STU series (540) Signature pad tablets with WebHID API on the browser, without external apps or drivers.

![https://i.imgur.com/H5AoTEg.png](https://i.imgur.com/H5AoTEg.png)

Library to connect the browser to a WACOM STU-540/k signature pad. It should be compatible with other STU devices as stated on the compatibility matrix, but they are untested.
Protocol is loosely reversed with wireshack but SDK contains most of the needed info to develop missing features. Issues and PRs are welcome.
As WebHID relies on promises all the methods return as such. Use await or set the promise callback. Only most basic features are implemented.

### Demo app
This library only offer a way to communicate with the tablet and does not provide image rendering / ink to graphics, however, a PoC-grade demo app is provided using the library. It supports image manipulation via canvas for the preview and upload of images to the tablet, and SVG polyline based renderer that somewhat supports pressure levels. The demo app has controls to test all the features implemented.
#### [View online demo](https://amsspecialist.com/wacomstu/demo.html)  (Must have a wacom stu-540 connected by usb)
#### [View video demo on youtube](https://youtu.be/Nkc5DdnVf1A)

### Supported API
`checkAvailable()` Check if a usb hid from wacom vid+pid is present

`bool connect()` Connect to the device

`object getTabletInfo()` Get an object containing info, capabilities and other data about the device

`setPenColorAndWidth(color,width)` Set pen color in "#RRGGBB" format. Width can be 0-5

`setBacklight(intensity)` Set backlight intensity, can be 0-3.

`setBackgroundColor(color)` Set background color in '#RRGGBB' format, must clear screen to take effect

`setWritingArea(object)` Set writing area of the tablet. x1,y1=left top | x2,y2=right bottom

`setWritingMode(mode)` Set writing mode (0: basic pen, 1: smooth pen with extra timing data)

`setInking(enabled)` Enable or disable inking the screen. This does not stop events.

`clearScreen()` Clear screen to background color

`setImage(imageData)` Send a raw image to the pad. Image must be BGR 24bpp 800x480.

`bool checkConnected()` Check if theres a device connected

`onPenData(function)` Set the data callback for pen events. Callback recives an object:
```js
{
        rdy: 	, // Returns TRUE if the pen is in proximity with the tablet
        sw:  	, // Returns TRUE if the pen is in contact with the surface
        press: 	, // Returns pen pressure in tablet units (0-1024)
        cx: 	, // Point in X in tablet scale (/13.5)
        cy: 	, // Point in Y in tablet scale (/13.5)
		x:		, // Untransformed X
		y:		, // Untransformed Y
        time: 	, // (Only for writingMode=1) timestamp
        seq:  	, // (Only for writingMode=1) incremental number
}
```
`onHidChange(function)` Set the callback for HID connect and disconnect events from devices matching wacom stu. Callback function recives `("connect/disconnect", deviceObject)`
### Usage:
```js		
const wacom = new wacomstu540()
if (await wacom.connect()) {
	//You are connected now to the tablet
	wacom.onPenData(function(pen){
	    // do something with pen.cx, pen.cy, pen.press, pen.sw...
	})
	await wacom.setWritingMode(1)
	//...
} else {
	//Cannot connect, maybe device is already in use, or cancelled, or no device at all
}
```
Note: Image updating on area and image on ROM are unimplemented yet, also special 540 features, like premade menus are also unimplemented. 
See: http://developer-docs.wacom.com/faqs/docs/q-stu/stu-540-modes

/*
	WACOM STU-540 WebHID Driver
	Pablo García <pablomorpheo@gmail.com>
*/
var wacomstu540 = function() 
{
	if (navigator == null || navigator.hid == null) return null
	
	// Variables
	this.width = 			800
	this.height = 			480
	this.config = {
		chunkSize: 			253,
		scaleFactor: 		13.5,
		pressureFactor:		1024,
		vid: 				1386,
		pid: 				168,
		imageFormat24BGR: 	0x04,
	}
	this.command = {
		penData: 			0x01,
		setWritingMode: 	0x0E,
		clear: 				0x20,
		inkMode: 			0x21,
		writeImageStart: 	0x25,
		writeImageData: 	0x26,
		writeImageEnd: 		0x27,
		setWritingArea: 	0x2A,
		setBrightness: 		0x2B,
		setBackgroundColor: 0x2E,
		setPenColorAndWidth:0x2D,
		penDataTiming: 		0x34,
	}
	this.onPenDataCb =		null
	this.onHidChangeCb =	null
	this.device = 			null
	this.image = 			null
	
	// Methods
	
	/**
	* Check is a usb hid from wacom vid+pid is present
	**/
	this.checkAvailable = async function() {
		if (this.checkConnected()) return true
		let devices = await navigator.hid.getDevices();
		for (let i = 0; i < devices.length; i++) {
			let device = devices[i]
			if (device.vendorId == this.config.vid && device.productId == this.config.pid) 
				return true
		}
		return false
	}.bind(this)
	
	/**
	* Connect to the device
	**/
	this.connect = async function(){
		if (this.checkConnected()) return
		let dev = await navigator.hid.requestDevice({filters: [{vendorId: this.config.vid, productId: this.config.pid}]})
		if (dev[0] == null) return false
		this.device = dev[0]
		await this.device.open()
		this.device.addEventListener("inputreport", async function(event) {
			if (this.onPenDataCb == null) return
			if (event.reportId == this.command.penData || event.reportId == this.command.penDataTiming) {
				let packet = {
					rdy: (event.data.getUint8(0) & (1 << 0)) !== 0, //Check 1st bit
					sw:  (event.data.getUint8(0) & (1 << 1)) !== 0, //Check 2nd bit
					cx:  Math.trunc(event.data.getUint16(2) / this.config.scaleFactor), //Truncated transformed logic units
					cy:  Math.trunc(event.data.getUint16(4) / this.config.scaleFactor), //Truncated transformed logic units
				}
				event.data.setUint8(0, event.data.getUint8(0) & 0x0F) //Remove MSB of the 1st byte, todo: maybe i should only clear bits 1,2?
				packet['press']    = event.data.getUint16(0) / this.config.pressureFactor //Read now as short with cleared MSB
				if (event.reportId == this.command.penDataTiming) {
					packet['time'] = event.data.getUint16(6) //Extra timing
					packet['seq']  = event.data.getUint16(8) //Extra incremental number
				}
				this.onPenDataCb(packet)
			}
		}.bind(this));
		return true
	}.bind(this)
	
	/**
	* Set pen color in "#RRGGBB" format. Width can be 0-5
	**/
	this.setPenColorAndWidth = async function(color,width) {
		if (!this.checkConnected()) return
		let c = color.replace('#','').split(/(?<=^(?:.{2})+)(?!$)/).map(e=>parseInt("0x"+e, 16)) //Converts "#RRGGBB" to Array(r,g,b)
		c.push(parseInt(width)) //Insert width byte
		await this.sendData(this.command.setPenColorAndWidth, new Uint8Array(c))
	}.bind(this)
	
	/**
	* Set backlight intensity, can be 0-3. 
	* Note: it seems its not good to call this frequently
	**/
	this.setBacklight = async function(intensity) {
		if (!this.checkConnected()) return
		let pk = this.makePacket(2)
		pk.view.setUint16(0,intensity,true) //Write as short, idk why...
		await this.sendData(this.command.setBrightness, pk.data)
	}.bind(this)
	
	/**
	* Set background color in '#RRGGBB' format, must clear screen to take effect
	**/
	this.setBackgroundColor = async function(color) {
		if (!this.checkConnected()) return
		let c = color.replace('#','').split(/(?<=^(?:.{2})+)(?!$)/).map(e=>parseInt("0x"+e, 16)) //Converts "#RRGGBB" to Array(r,g,b)
		await this.sendData(this.command.setBackgroundColor, new Uint8Array(c))
	}.bind(this)
	
	/**
	* Set writing area of the tablet. x1,y1=left top | x2,y2=right bottom
	**/
	this.setWritingArea = async function(p) {
		if (!this.checkConnected()) return
		let pk = this.makePacket(8)
		pk.view.setUint16(0,p.x1,true)
		pk.view.setUint16(2,p.y1,true)
		pk.view.setUint16(4,p.x2,true)
		pk.view.setUint16(6,p.y2,true)
		await this.sendData(this.command.setWritingArea, pk.data)
	}.bind(this)
	
	/**
	* Set writing mode (0: basic pen, 1: smooth pen with extra timing data)
	**/
	this.setWritingMode = async function(mode) {
		if (!this.checkConnected()) return
		await this.sendData(this.command.setWritingMode, new Uint8Array([mode]))
	}.bind(this)
	
	/**
	* Enable or disable inking the screen. This does not stop events.
	**/
	this.setInking = async function(enabled) {
		if (!this.checkConnected()) return
		await this.sendData(this.command.inkMode, new Uint8Array([enabled ? 1 : 0]))
	}.bind(this)
	
	/**
	* Clear screen to background color
	**/
	this.clearScreen = async function() {
		if (!this.checkConnected()) return
		await this.sendData(this.command.clear, new Uint8Array([0]))
	}.bind(this)
	
	/**
	* Send a raw image to the pad. Image must be BGR 24bpp 800x480.
	**/
	this.setImage = async function(imageData) {
		if (!this.checkConnected() && this.image != null) return
		if (imageData != null) 
			this.image = this.splitToBulks(imageData, this.config.chunkSize)
		//Only 24BGR is supported now, send start packet, then chunked data packets, then end packet
		await this.sendData(this.command.writeImageStart, new Uint8Array([this.config.imageFormat24BGR]))
		this.image.forEach(async function(e) {
			await this.sendData(this.command.writeImageData, new Uint8Array([e.length,0].concat(e)))
		}.bind(this))
		await this.sendData(this.command.writeImageEnd, new Uint8Array([0]))
	}.bind(this)
	
	//Helpers
	
	/**
	* Check if theres a device connected
	**/
	this.checkConnected = function(){
		return this.device != null && this.device.opened
	}.bind(this)
	
	/**
	* Send direct usb hid feature report
	**/
	this.sendData = async function(reportId, data) {
		if (!this.checkConnected()) return
		await this.device.sendFeatureReport(reportId, data)
	}.bind(this)
	
	/**
	* Return an object containing an array of (len) bytes and a DataView for manipulation
	**/
	this.makePacket = function(len) {
		let p = new Uint8Array(len)
		let v = new DataView(p.buffer)
		return {data: p, view: v}
	}
	
	/**
	* Truncates a long array (arr) into smaller arrays of bulkSize 
	* (into an array, last item's length could be less than bulkSize)
	**/
	this.splitToBulks = function(arr, bulkSize) {
		const bulks = []
		for (let i = 0; i < Math.ceil(arr.length / bulkSize); i++) {
			var a = Array(bulkSize)
			for (var x = i * bulkSize, z = 0; x < (i + 1) * bulkSize; x++, z++) 
				a[z] = arr[x]
			bulks.push(a)
		}
		return bulks
	}
	
	//Event handler
	
	/**
	* Set the data callback for pen events.
	* Callback function recives an object:
	* {
	* 	rdy: 	Returns TRUE if the pen is in proximity with the tablet
	* 	sw:  	Returns TRUE if the pen is in contact with the surface
	* 	press: 	Returns pen pressure in tablet units (0-1024)
	* 	cx: 	Point in X in tablet scale (13.5)
	* 	cy: 	Point in Y in tablet scale (13.5)
	* 	time: 	(Only for writingMode=1) timestamp
	* 	seq:  	(Only for writingMode=1) incremental number
	* }
	**/
	this.onPenData = function(func) {
		this.onPenDataCb = func
	}.bind(this)
	
	/**
	* Set the callback for HID connect and disconnect events from devices matching wacom stu
	* Callback function recives ("connect/disconnect", deviceObject)
	**/
	this.onHidChange = function(func) {
		this.onHidChangeCb = func
	}.bind(this)
	
	// HID events
	navigator.hid.addEventListener("connect", function(e) {
		if (this.onHidChangeCb != null && e.device.vendorId == this.config.vid && e.device.productId == this.config.pid) 
			this.onHidChangeCb('connect', e.device)
	}.bind(this));
	navigator.hid.addEventListener("disconnect", function(e) {
		if (this.onHidChangeCb != null && e.device.vendorId == this.config.vid && e.device.productId == this.config.pid) 
			this.onHidChangeCb('disconnect', e.device)
	}.bind(this));
	
	return this;
}

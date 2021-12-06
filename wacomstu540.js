/*
    WACOM STU-540 WebHID Driver
    ___________________________________________________

    Pablo García <pablomorpheo@gmail.com>
    https://github.com/pabloko/Wacom-STU-WebHID

*/
var wacomstu540 = function () {

    // Check if WebHID is supported
    if (navigator == null || navigator.hid == null) return null

    /**
     * Device configuration, information and capabilities
     */
    this.config = {
        chunkSize: 253,
        vid: 1386,
        pid: 168,
        imageFormat24BGR: 0x04,
        width: 800,
        height: 480,
        scaleFactor: 13.5,
        pressureFactor: 1023,
        refreshRate: 0,
        tabletWidth: 0,
        tabletHeight: 0,
        deviceName: null,
        firmware: null,
        eSerial: null,
        onPenDataCb: null,
        onHidChangeCb: null,
    }

    /**
     * Report ids (See SDK for more info and compatibility matrix, direction, etc...)
     */
    this.command = {
        penData: 0x01,
        information: 0x08,
        capability: 0x09,
        writingMode: 0x0E,
        eSerial: 0x0F,
        clearScreen: 0x20,
        inkMode: 0x21,
        writeImageStart: 0x25,
        writeImageData: 0x26,
        writeImageEnd: 0x27,
        writingArea: 0x2A,
        brightness: 0x2B,
        backgroundColor: 0x2E,
        penColorAndWidth: 0x2D,
        penDataTiming: 0x34,
    }

    // Store internal hidDevice 
    this.device = null
    // Store internal image chunks to resend without reprocess
    this.image = null

    // Methods

    /**
     * Check is a usb hid from wacom vid+pid is present
     * Note: It seems WebHID needs a positive hid.requestDevice to be allowed to show here and on hid events. do not rely on this for the first connect
     * @returns {Boolean} found a compatible device
     */
    this.checkAvailable = async function () {
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
     * @returns {Boolean} success or failure
     */
    this.connect = async function () {
        if (this.checkConnected()) return
        let dev = await navigator.hid.requestDevice({ filters: [{ vendorId: this.config.vid, productId: this.config.pid }] })
        if (dev[0] == null) return false
        this.device = dev[0]
        // Open the device
        await this.device.open()
        // Set handler to read input reports (this contains pen data)
        this.device.addEventListener("inputreport", async function (event) {
            if (this.config.onPenDataCb == null) return
            // See WacomGSS_ReportHandlerFunctionTable on the SDK. just read onPenData and onPenDataTimeCountSequence, depending
            // of the write mode used (0/1). Start/End capture toggles encryption which im not in the mood of implement, so not using it.
            if (event.reportId == this.command.penData || event.reportId == this.command.penDataTiming) {
                let packet = {
                    rdy: (event.data.getUint8(0) & (1 << 0)) !== 0, //Check 1st bit
                    sw: (event.data.getUint8(0) & (1 << 1)) !== 0, //Check 2nd bit
                    cx: Math.trunc(event.data.getUint16(2) / this.config.scaleFactor), //Truncated transformed logic units
                    cy: Math.trunc(event.data.getUint16(4) / this.config.scaleFactor), //Truncated transformed logic units
                    x: event.data.getUint16(2), //Tablet units
                    y: event.data.getUint16(4), //Tablet units
                    press: 0,
                    seq: null,
                    time: null,
                }
                event.data.setUint8(0, event.data.getUint8(0) & 0x0F) //Remove MSB of the 1st byte, todo: maybe i should only clear bits 1,2?
                packet.press = event.data.getUint16(0) / this.config.pressureFactor //Read now as short with cleared MSB
                if (event.reportId == this.command.penDataTiming) {
                    packet.time = event.data.getUint16(6) //Extra timing
                    packet.seq = event.data.getUint16(8) //Extra incremental number
                }
                this.config.onPenDataCb(packet)
            }
        }.bind(this));
        // Read info and capabilities from device and fill the data
        let dv = await this.readData(this.command.capability)
        this.config.tabletWidth = dv.getUint16(1)
        this.config.tabletHeight = dv.getUint16(3)
        this.config.pressureFactor = dv.getUint16(5)
        this.config.width = dv.getUint16(7)
        this.config.height = dv.getUint16(9)
        this.config.refreshRate = dv.getUint8(11)
        this.config.scaleFactor = this.config.tabletWidth / this.config.width
        // ...leftover info unknown / not needed
        dv = await this.readData(this.command.information)
        this.config.deviceName = this.dataViewString(dv, 1, 7)
        this.config.firmware = dv.getUint8(8) + "." + dv.getUint8(9) + "." + dv.getUint8(10) + "." + dv.getUint8(11)
        // ...leftover info unknown / not needed
        dv = await this.readData(this.command.eSerial)
        this.config.eSerial = this.dataViewString(dv, 1)
        return true
    }.bind(this)

    /**
     * Retrives general data from the device
     * @returns {Object} info of the device
     */
    this.getTabletInfo = function () {
        if (!this.checkConnected()) return
        return this.config
    }.bind(this)

    /**
     * Set pen color
     * @param {String} color color in '#RRGGBB' format
     * @param {Number} width pen thickness, can be 0-5
     */
    this.setPenColorAndWidth = async function (color, width) {
        if (!this.checkConnected()) return
        let c = color.replace('#', '').split(/(?<=^(?:.{2})+)(?!$)/).map(e => parseInt("0x" + e, 16)) //Converts "#RRGGBB" to Array(r,g,b)
        c.push(parseInt(width)) //Insert width byte, so array now has 4 elements
        await this.sendData(this.command.penColorAndWidth, new Uint8Array(c))
    }.bind(this)

    /**
     * Set backlight intensity, can be 0-3. 
     * Note: it seems its not good to call this frequently.
     * See: http://developer-docs.wacom.com/faqs/docs/q-stu/stu-sdk-application#how-can-i-switch-the-stu-off-when-not-in-use
     */
    this.setBacklight = async function (intensity) {
        if (!this.checkConnected()) return
        // Check if device already has this value, to avoid unnecessary writes
        let dv = await this.readData(this.command.brightness)
        if (dv.getUint8(1) == intensity) return
        await this.sendData(this.command.brightness, new Uint8Array([intensity, 0]))
    }.bind(this)

    /**
     * Set background color, must clear screen to take effect
     * Note: it seems its not good to call this frequently
     * @param {String} color color in '#RRGGBB' format
     */
    this.setBackgroundColor = async function (color) {
        if (!this.checkConnected()) return
        let c = color.replace('#', '').split(/(?<=^(?:.{2})+)(?!$)/).map(e => parseInt("0x" + e, 16)) //Converts "#RRGGBB" to Array(r,g,b)
        // Check if device already has this value, to avoid unnecessary writes
        let dv = await this.readData(this.command.backgroundColor)
        if (dv.getUint8(1) == c[0] && dv.getUint8(2) == c[1] && dv.getUint8(3) == c[2]) return
        await this.sendData(this.command.backgroundColor, new Uint8Array(c))
    }.bind(this)

    /**
     * Set writing area of the tablet. 
     * @param {Object} p format {x1:0,x2:0,x1:800,y1:480} where x1,y1=left top and x2,y2=right bottom
     */
    this.setWritingArea = async function (p) {
        if (!this.checkConnected()) return
        let pk = this.makePacket(8)
        pk.view.setUint16(0, p.x1, true)
        pk.view.setUint16(2, p.y1, true)
        pk.view.setUint16(4, p.x2, true)
        pk.view.setUint16(6, p.y2, true)
        await this.sendData(this.command.writingArea, pk.data)
    }.bind(this)

    /**
     * Set writing mode
     * @param {Number} mode 0: basic pen, 1: smooth pen with extra timing data
     */
    this.setWritingMode = async function (mode) {
        if (!this.checkConnected()) return
        await this.sendData(this.command.writingMode, new Uint8Array([mode]))
    }.bind(this)

    /**
     * Enable or disable inking the screen. This does not stop events.
     * @param {Boolean} enabled Status of inking
     */
    this.setInking = async function (enabled) {
        if (!this.checkConnected()) return
        await this.sendData(this.command.inkMode, new Uint8Array([enabled ? 1 : 0]))
    }.bind(this)

    /**
     * Clear screen to background color
     */
    this.clearScreen = async function () {
        if (!this.checkConnected()) return
        await this.sendData(this.command.clearScreen, new Uint8Array([0]))
    }.bind(this)

    /**
     * Send a raw image to the pad. 
     * @param {Array} imageData Image must be BGR 24bpp 800x480. If null, it will send last image.
     */
    this.setImage = async function (imageData) {
        if (!this.checkConnected()) return
        if (imageData != null)
            this.image = this.splitToBulks(imageData, this.config.chunkSize)
        if (this.image == null) return
        //Only 24BGR is supported now, send start packet, then chunked data packets, then end packet
        await this.sendData(this.command.writeImageStart, new Uint8Array([this.config.imageFormat24BGR]))
        this.image.forEach(async function (e) {
            await this.sendData(this.command.writeImageData, new Uint8Array([e.length, 0].concat(e)))
        }.bind(this))
        await this.sendData(this.command.writeImageEnd, new Uint8Array([0]))
    }.bind(this)

    // Helpers

    /**
     * Check if theres a device connected
     * @returns {Boolean} connection status
     */
    this.checkConnected = function () {
        return this.device != null && this.device.opened
    }.bind(this)

    /**
     * Send direct usb hid feature report (internal usage)
     * @param {Number} reportId ID of the report to read. Use one of this.command
     */
    this.sendData = async function (reportId, data) {
        if (!this.checkConnected()) return
        await this.device.sendFeatureReport(reportId, data)
    }.bind(this)

    /**
     * Get a report from the device (internal usage)
     * @param {Number} reportId ID of the report to read. Use one of this.command
     * @returns {DataView} data returned or null
     */
    this.readData = async function (reportId) {
        if (!this.checkConnected()) return
        return await this.device.receiveFeatureReport(reportId)
    }.bind(this)

    /**
     * Return an object containing an array of (len) bytes and a DataView for manipulation
     * (internal usage)
     * @param {any} len size in bytes of the packet
     */
    this.makePacket = function (len) {
        let p = new Uint8Array(len)
        let v = new DataView(p.buffer)
        return { data: p, view: v }
    }

    /**
     * Truncates a long array (arr) into smaller arrays of bulkSize 
     * (into an array, last item's length could be less than bulkSize)
     * (internal usage)
     * @param {Array} arr Array or derivated type containing full image data
     * @param {Number} bulkSize size of the resulting subarrays
     * @returns {Array} Array of arrays containing data splitted
     */
    this.splitToBulks = function (arr, bulkSize) {
        const bulks = []
        for (let i = 0; i < Math.ceil(arr.length / bulkSize); i++) {
            var a = Array(bulkSize)
            for (var x = i * bulkSize, z = 0; x < (i + 1) * bulkSize; x++, z++)
                a[z] = arr[x]
            bulks.push(a)
        }
        return bulks
    }

    /**
     * Obtains an ASCII string from DataView
     * @param {DataView} dv DataView to read
     * @param {Number} offset Position to start
     * @param {Number} length Optional end of string
     * @returns {String} String result
     */
    this.dataViewString = function (dv, offset, length) {
        var end = typeof length == 'number' ? offset + length : dv.byteLength, text = '', val = -1
        while (offset < dv.byteLength && offset < end) {
            val = dv.getUint8(offset++)
            if (val == 0) break
            text += String.fromCharCode(val)
        }
        return text
    }

    // Event handlers

    /**
     * Set the data callback for pen events.
     * @param {Function} func Callback function recives an object:
     * -------------------------------------------------------------------------
     *   	rdy: 	Returns TRUE if the pen is in proximity with the tablet
     *   	sw:  	Returns TRUE if the pen is in contact with the surface
     *   	press: 	Returns pen pressure in tablet units (0-1024)
     *   	cx:     Transformed x
     *   	cy:     Transformed y
     *   	x: 	    Point in X in tablet scale (*13.5)
     *   	y: 	    Point in Y in tablet scale (*13.5)
     *   	time: 	(Only for writingMode=1) timestamp
     *   	seq:  	(Only for writingMode=1) incremental number
     */
    this.onPenData = function (func) {
        this.config.onPenDataCb = func
    }.bind(this)

    /**
     * Set the callback for HID connect and disconnect events from devices matching wacom stu
     * @param {Function} func Callback function recives ("connect/disconnect", hidDeviceObject)
     */
    this.onHidChange = function (func) {
        this.config.onHidChangeCb = func
    }.bind(this)

    // HID events
    navigator.hid.addEventListener("connect", function (e) {
        if (this.config.onHidChangeCb != null && e.device.vendorId == this.config.vid && e.device.productId == this.config.pid)
            this.config.onHidChangeCb('connect', e.device)
    }.bind(this))
    navigator.hid.addEventListener("disconnect", function (e) {
        if (this.config.onHidChangeCb != null && e.device.vendorId == this.config.vid && e.device.productId == this.config.pid)
            this.config.onHidChangeCb('disconnect', e.device)
    }.bind(this))

    return this
}

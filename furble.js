const fluff_service = 'dab91435-b5a1-e29c-b041-bcd562613bde';

var furby_uuids = {
    'GeneralPlusListen': 'dab91382-b5a1-e29c-b041-bcd562613bde',
    'GeneralPlusWrite':  'dab91383-b5a1-e29c-b041-bcd562613bde',
    'NordicListen':      'dab90756-b5a1-e29c-b041-bcd562613bde',
    'NordicWrite':       'dab90757-b5a1-e29c-b041-bcd562613bde',
    'RSSIListen':        'dab90755-b5a1-e29c-b041-bcd562613bde',
    'F2FListen':         'dab91440-b5a1-e29c-b041-bcd562613bde',
    'F2FWrite':          'dab91441-b5a1-e29c-b041-bcd562613bde',
    'FileWrite':         'dab90758-b5a1-e29c-b041-bcd562613bde'
}

var file_transfer_modes = {
    1: 'EndCurrentTransfer',
    2: 'ReadyToReceive',
    3: 'FileTransferTimeout',
    4: 'ReadyToAppend',
    5: 'FileReceivedOk',
    6: 'FileReceivedErr'
}

const SLOT_EMPTY = 0;
const SLOT_UPLOADING = 1;
const SLOT_FILLED = 2;
const SLOT_ACTIVE = 3;

function flipDict(d) {
    let flipped = {};
    for (let k in d) {
      let v = d[k];
      flipped[v] = k;
    }
    return flipped;
}

var uuid_lookup = flipDict(furby_uuids);
var file_transfer_lookup = flipDict(file_transfer_modes);
var device;
var isConnected = false;
var isTransferring = false;
var furby_chars = {};
var gp_listen_callbacks = [];
var nordicListener = null;
var keepAliveTimer = null;
var lastCommandSent = 0;
var NO_RESPONSE = Symbol();


function log() {
    let bits = []
    for (let arg of arguments) {
        if (DataView.prototype.isPrototypeOf(arg))
            bits.push(buf2hex(arg))
        else
            bits.push(''+arg)
    }
    var s = bits.join(' ')
    console.log(s);
    let o = document.getElementById('out');
    o.textContent += s + "\n";
    o.scrollTop = o.scrollHeight;
}

function sendGPCmd(data, response_prefix) {
    return new Promise((resolve, reject) => {
        if (data.length != 2 && data[0] != 0x20 && data[1] != 0x06)
            log('Sending data to GeneralPlusWrite', buf2hex(data));
        var hnd;
        if (response_prefix != NO_RESPONSE) {
            hnd = addGPListenCallback(response_prefix, buf => {
                removeGPListenCallback(hnd);
                resolve(buf);
            });
        }
        lastCommandSent = performance.now();
        furby_chars.GeneralPlusWrite.writeValue(new Uint8Array(data))
            .then(() => {
                
                // if we're not expecting a response resolve once the data's been sent
                if (response_prefix == NO_RESPONSE) 
                    resolve();
            }).catch(error => {
                if (response_prefix != NO_RESPONSE)
                    removeGPListenCallback(hnd);
                reject(error);
            });
    });
}

function addGPListenCallback(response_prefix, fn) {
    let handle = gp_listen_callbacks.length;
    gp_listen_callbacks[handle] = [fn, response_prefix];
    return handle;
}

function removeGPListenCallback(handle) {
    delete gp_listen_callbacks[handle];
}

function handleGeneralPlusResponse(event) {
    let buf = event.target.value;
    if (buf.getUint8(0) != 0x22) // don't spam log with ImHereSignal keepalive responses TODO: decode this packet
        log('Got GeneralPlus response', buf);
    else {
        console.log(buf2hex(buf));
    }
    for (let handle in gp_listen_callbacks) {
        let [cb, prefix] = gp_listen_callbacks[handle];
        if (prefixMatches(prefix, buf))
            cb(buf);
    }
}

function prefixMatches(prefix, buf) {
    if (typeof(prefix) == 'undefined')
        return true;

    for (let i=0; i < prefix.length; i++) {
        if (buf.getUint8(i) != prefix[i])
            return false;
    }
    return true;
}

function triggerAction(input, index, subindex, specific) {
    if (arguments.length == 1)
        data = [0x10, 0, input];
    else if (arguments.length == 2)
        data = [0x11, 0, input, index];
    else if (arguments.length == 3)
        data = [0x12, 0, input, index, subindex];
    else if (arguments.length == 4)
        data = [0x13, 0, input, index, subindex, specific];
    else 
        throw 'Must specify at least an input';
    return sendGPCmd(data, NO_RESPONSE);
}

function customAction() {
    let args = [];
    document.querySelectorAll('input[name=furby-action]').forEach(el => args.push(parseInt(el.value)));
    console.log(args);
    triggerAction.apply(null, args);
}
function enableEyes(b) {
    return sendGPCmd([0xcd, b ? 1 : 0], NO_RESPONSE);
}
function loadDLC(slot) {
    return sendGPCmd([0x60, slot], [0xdc]);
}

function activateDLC() {
    return sendGPCmd([0x61], [0xdc]);
}

function deactivateDLC(slot) {
    return sendGPCmd([0x62, slot], [0xdc]);
}

async function loadAndActivateDLC(slot) {
    await loadDLC(slot);
    await activateDLC();
}

async function getDLCInfo() {
    let buf = await sendGPCmd([0x72], [0x72]);
    log('dlc info: ', buf);
    let filledSlots = (buf.getUint8(3) << 8) |  buf.getUint8(4);
    let activeSlots = (buf.getUint8(7) << 8) |  buf.getUint8(8);
    let slots = [];
    for (let i=0; i < 14; i++) {
        slots[i] = 0;
        if (filledSlots & (1 << i))
            slots[i] = SLOT_FILLED;
        if (activeSlots & (1 << i))
            slots[i] = SLOT_ACTIVE;
    }
    return slots;
}

async function getAllDLCInfo() {
    let allSlotsInfo = await getDLCInfo();
    var slots = [];
    for (let i=0; i < allSlotsInfo.length; i++) {
        if (allSlotsInfo[i] != SLOT_EMPTY) {
            slots[i] = await getDLCSlotInfo(i);
            slots[i].status = allSlotsInfo[i];
        }
    }
    console.log(slots);
}

async function getActiveSlotInfo() {
    let allSlotsInfo = await getDLCInfo();
    let activeSlot = allSlotsInfo.indexOf(SLOT_ACTIVE);
    if (activeSlot == -1) return null;
    return await getDLCSlotInfo(activeSlot);
}


async function getDLCSlotInfo(slot) {
    let buf = await sendGPCmd([0x73, slot], [0x73, slot]);
    //log('Got slot info', buf);
    var props = {};
    props.len = buf.getUint32(9) & 0xffffff;
    if (props.len > 0) {
        let namebuf = new DataView(buf.buffer, 2, 8);
        let decoder = new TextDecoder('utf-8');
        props.name = decoder.decode(namebuf);
        props.checksum =  buf.getUint32(13);
        log(`slot ${slot} name: ${props.name}, length: ${props.len} chksum: 0x` + props.checksum.toString(16));
    } else {
        log(`slot ${slot} is empty`);
    }
    
    return props;
    // 73 0d 5455303032393439 04c95a 2754ea15 - 73, slot number, filename (minus extension), length, adler32 checksum
}

function deleteDLC(slot) {
    return sendGPCmd([0x74, slot], [0x74]);
}

async function deleteAllDLCSlots() {
    for (let i=0; i<14; i++) {
        await deactivateDLC(i);
        await deleteDLC(i);
    }
}

async function getFirmwareVersion() {
    let buf = await sendGPCmd([0xfe], [0xfe]);
    let version = buf.getUint8(1)
    log('Firmware version ', version);
    return version;
}

function setAntennaColor(r, g, b) {
    log(`Setting antenna color to (${r}, ${g}, ${b})`);
    return sendGPCmd([0x14, r, g, b], NO_RESPONSE);
}

function cycleDebug() {
    return sendGPCmd([0xdb], NO_RESPONSE);
}

function startKeepAlive() {
    keepAliveTimer = setInterval(async () => {
        if (isTransferring) return;
        if (performance.now() - lastCommandSent > 3000) {
            let buf = await sendGPCmd([0x20, 0x06], [0x22]);
            //log('Got ImHereSignal', buf);
        }
       
    }, 1000);
}

function setNordicNotifications(enable, cb) {
    let data = [9, (enable ? 1 : 0), 0];
    nordicListener = enable ? cb : null;
    return furby_chars.NordicWrite.writeValue(new Uint8Array(data));
}

function handleNordicNotification(event) {
    //log('Nordic listen', buf);
    if (nordicListener) 
        nordicListener(event.target.value);
}

function makeDLCFilename(dlcurl) {
    return dlcurl.substr(dlcurl.lastIndexOf('/') + 1).padStart(12, '_').toUpperCase();
}

async function fetchAndUploadDLC(dlcurl) {
    let response = await fetch(dlcurl);
    if (response.status != 200) {
        throw new Error('Failed to fetch DLC', dlcurl);
        msg.error('DLC not found on server');
    }

    let buf = await response.arrayBuffer();
    let chksumOriginal = adler32(buf);
    log('Fetched DLC from server:', dlcurl, ' checksum 0x' + chksumOriginal.toString(16));
    var progress = document.getElementById('dlcprogress');
    progress.max = buf.byteLength;

    try {
        progress.style.display = 'block';
        progress.removeAttribute('value');
        let c = 0;
        //log('Clearing all DLC slots...');
        //await deleteAllDLCSlots();
        await enableEyes(false); // eyes off, save battery
        await setAntennaColor(0,0,0);
        let name = makeDLCFilename(dlcurl);
        let started = false;
        await uploadDLC(buf, name, (current, total, maxRx) => {
            if (c % 100 == 0) 
                progress.value = current;
            if (c % 500 == 0)
                console.log(`transfer: ${current}/${total} maxRx:${maxRx}`);
            if (!started) {
                started = true;
                msg.ok('Eyes off while Uploading...');
            }
            c++; 
        });
        msg.ok('DLC uploaded!');
    } catch (e) {
        msg.error('DLC upload failed :(');
        log(e.message);
        console.error(e);
        await setAntennaColor(255,0,0);
        return;
    } finally {
        progress.style.display = 'none';
        await enableEyes(true); // eyes on
    }

    try { 
        let slots = await getDLCInfo();
        let filledSlot = slots.indexOf(SLOT_FILLED);
        let activeSlot = slots.indexOf(SLOT_ACTIVE);
        if (filledSlot == -1)
            throw new Error('Upload failed - no slots filled');
        else {
            log('DLC was uploaded to slot ' + filledSlot);
        }
        if (activeSlot != -1) {
            log('deactivating old DLC in slot ' + activeSlot);
            await deactivateDLC(activeSlot)
        }
        
        let slotInfo = await getDLCSlotInfo(filledSlot);
        if (slotInfo.checksum != chksumOriginal) {
            throw new Error('Expected checksum of 0x' + chksumOriginal.toString(16) + ' but got 0x' + slotInfo.checksum.toString(16));
        }
        await loadAndActivateDLC(filledSlot);
        slots = await getDLCInfo();
        if (slots.indexOf(SLOT_ACTIVE) != filledSlot)
            throw new Error('Failed to activate');
        msg.ok('DLC activated!');
        await setAntennaColor(0,255,0);
    } catch (e) {
        msg.error('DLC activation failed :(');
        log(e.message);
        console.log(e);
        await setAntennaColor(255,0,0);
    } 
}

function adler32(buf) {
    const MOD_ADLER = 65521;
    let dv = new DataView(buf);
    let a=1, b=0;
    for (let i=0; i < buf.byteLength; i++) {
        a = (a + dv.getUint8(i)) % MOD_ADLER;
        b = (b + a) % MOD_ADLER;
    }
    let checksum = (b << 16) >>> 0;
    return (checksum | a) >>> 0;
}

async function adler32test(url) {
    let resp = await fetch(url);
    let buf = await resp.arrayBuffer();
    console.log(buf);
    let checksum = adler32(buf);
    console.log('0x' + checksum.toString(16));
}

function uploadDLC(dlcbuf, filename, progresscb) {
    if (isTransferring) return Promise.reject('Transfer already in progress');
    let size = dlcbuf.byteLength;
    if (filename.length != 12)
        return Promise.reject('Filename must be 12 chars long');
    let initcmd = [0x50, 0x00,
        size >> 16 & 0xff, size >> 8 & 0xff, size & 0xff, 
        2];
    let encoder = new TextEncoder('utf-8');
    initcmd = initcmd.concat(Array.from(encoder.encode(filename)));
    initcmd = initcmd.concat([0,0]);
    isTransferring = false;
    let sendPos = 0;
    let rxPackets = 0;
    let CHUNK_SIZE = 20;
    let MAX_BUFFERED_PACKETS = 10;
    let maxRx = 0;
    let failedWrites = 0;

    return new Promise((resolve, reject) => {
        let transferNextChunk = () => {
            if (!isTransferring)
                return;
            if (rxPackets > MAX_BUFFERED_PACKETS) {
                log(`rxPackets=${rxPackets}, pausing...`);
                setTimeout(transferNextChunk, 100);
                return;
            }
            let chunk = dlcbuf.slice(sendPos, sendPos + CHUNK_SIZE);
            if (chunk.byteLength > 0) {
                furby_chars.FileWrite.writeValue(chunk).then(() => {
                    lastCommandSent = performance.now();
                    sendPos += chunk.byteLength;
                    if (progresscb)
                        progresscb(sendPos, size, maxRx);
                    if (sendPos < size)
                        setTimeout(transferNextChunk, 1);
                    else 
                        log('Sent final packet');
                }).catch(error => {
                    //removeGPListenCallback(hnd)
                    console.log(error);
                    if (++failedWrites > 3) {
                        log('FileWrite.writeValue failed, will retry');
                        setTimeout(transferNextChunk, 16);
                    } else {
                        log('FileWrite.writeValue failed, giving up after too many failures');
                        isTransferring = false;
                        removeGPListenCallback(hnd);
                        reject(error);
                    }
                    
                    //reject(error);
                });  
            } else {
                log('tried to send empty packet??');
                isTransferring = false;
            }
        }

        let hnd = addGPListenCallback([0x24], buf => {
            let fileMode = buf.getUint8(1);
            log('Got FileWrite callback: ' + file_transfer_modes[fileMode]);
            if (fileMode == file_transfer_lookup.FileTransferTimeout ||
                fileMode == file_transfer_lookup.FileReceivedErr) {
                isTransferring = false;
                removeGPListenCallback(hnd);
                setNordicNotifications(false);
                reject('File Transfer error');
            } else if (fileMode == file_transfer_lookup.FileReceivedOk) {
                // TODO: sometimes we get a FileReceivedErr after getting FileReceivedOk
                // so we should add a delay before resolving to allow for failure
                log(`sendPos: ${sendPos} / ${size}`);
                isTransferring = false;
                removeGPListenCallback(hnd);
                setNordicNotifications(false);
                resolve();
            } else if (fileMode == file_transfer_lookup.ReadyToReceive) {
                isTransferring = true;
                transferNextChunk();
            }
        });

        let nordicCallback = (buf) => {
            let code = buf.getUint8(0);
            if (code == 0x09) {
                rxPackets = buf.getUint8(1);
                if (rxPackets > maxRx) maxRx = rxPackets;
                //console.log(`NordicListen GotPacketAck ${rxPackets}`);
                //transferNextChunk();
            } else if (code == 0x0a) {
                log('NordicListen GotPacketOverload', buf);
            } else {
                log('NordicListen uknown', buf);
            }
        };

        setNordicNotifications(true, nordicCallback).then(() => {
            log('Sending init DLC: ', buf2hex(initcmd), 'file length 0x' + size.toString(16));
            furby_chars.GeneralPlusWrite.writeValue(new Uint8Array(initcmd)).catch(error => reject(error));
        }).catch(error => reject(error));
    });
}

function onDisconnected() {
    log('> Bluetooth Device disconnected');
    msg.error('Device Disconnected');
    clearInterval(keepAliveTimer);
    isConnected = false;
    document.getElementById('connbtn').textContent = 'Connect';
    document.getElementById('state').textContent = 'Not Connected';
    enableButtons(false);
    
}

function enableButtons(enabled) {
    document.querySelectorAll('#furby-buttons button, #furby-buttons select').forEach(
        el => {
            if (enabled)
                el.removeAttribute('disabled')
            else
                el.setAttribute('disabled', 'disabled')
        });
}

function onConnected() {
    startKeepAlive();
    isConnected = true;
    msg.ok('Connected!');
    document.getElementById('connbtn').textContent = 'Disconnect';
    document.getElementById('state').textContent = 'Connected';
    enableButtons(true);
}

function buf2hex(dv) {
    var s = '';
    if (DataView.prototype.isPrototypeOf(dv)) {
        for (var i=0; i < dv.byteLength; i++) {
            s += ('0' + dv.getUint8(i).toString(16)).substr(-2);
        }
    } else if (Array.prototype.isPrototypeOf(dv)) {
        for (var i=0; i < dv.length; i++) {
            s += ('0' + dv[i].toString(16)).substr(-2);
        }    
    }
    return s;
}

function doConnectDisconnect() {
    isConnected ? doDisconnect() : doConnect();
}

async function doDisconnect() {
    try {
      log('Disconnecting from GATT Server...');
      device.gatt.disconnect();
    } catch (e) {
      log('Argh! ' + e);
    }
}

function sleep(t) {
    return new Promise(resolve  => setTimeout(resolve, t));
}

async function checkActiveSlot() {
    let activeSlot = await getActiveSlotInfo();
    if (activeSlot) {
        let filename = activeSlot.name.replace(/^_+/, '') + '.dlc'.toUpperCase();
        log('current active slot is ' + activeSlot.name + ' looking for ' + filename);
        for (k in dlcdata) {
            if (k.toUpperCase() == filename) {
                log('setting up buttons for ' + k);
                setupDLCButtons(dlcdata[k]);
            }
        }
    }
}

function onFurbySensorData(buf) {
    let state = decodeFurbyState(buf);
    console.log(state);
    let ul = document.getElementById('sensor-state');
    //ul.outerHTML = '<ul></ul>';
    while (ul.firstChild) {
        ul.removeChild(ul.firstChild);
    }

    for (k in state) {
        let v = state[k];
        let li = document.createElement('li');
        li.textContent = `${k}: ${v}`;
        ul.appendChild(li);
    }
}

function decodeFurbyState(buf) {
    let antenna = '';
    if (buf.getUint8(1) & 2)
        antenna = 'left';
    if (buf.getUint8(1) & 1)
        antenna = 'right';
    if (buf.getUint8(2) == 0xc0) // fwd | back
        antenna = 'down';
    else if (buf.getUint8(2) & 0x40)
        antenna = 'forward';
    else if (buf.getUint8(2) & 0x80)
        antenna = 'back';

    let orientation = '';
    if (buf.getUint8(4) & 1) 
        orientation = 'upright';
    else if (buf.getUint8(4) & 2) 
        orientation = 'upside-down';   
    else if (buf.getUint8(4) & 4) 
        orientation = 'lying on right side';   
    else if (buf.getUint8(4) & 8) 
        orientation = 'lying on left side';      
    else if (buf.getUint8(4) & 0x20) 
        orientation = 'leaning back';
    else if (buf.getUint8(4) & 0x40) 
        orientation = 'tilted right'; 
    else if (buf.getUint8(4) & 0x80) 
        orientation = 'tilted left';    
    var state = {};
    state['antenna'] = antenna;
    state['orientation'] = orientation;

    if (buf.getUint8(2) & 1)
        state.tickle_head_back = true;
    if (buf.getUint8(2) & 2)
        state.tickle_tummy = true;
    if (buf.getUint8(2) & 4)
        state.tickle_right_side = true;
    if (buf.getUint8(2) & 8)
        state.tickle_left_side = true;
    if (buf.getUint8(2) & 0x10)
        state.pull_tail = true;
    if (buf.getUint8(2) & 0x20)
        state.push_tongue = true;
    return state;
}

async function doConnect() {
    log('Requesting Bluetooth Devices with Furby name...');
    var server;
    try {
        device = await navigator.bluetooth.requestDevice({
            filters: [{ name: 'Furby'}], 
            optionalServices: ['generic_access', 'device_information', fluff_service]});
        device.addEventListener('gattserverdisconnected', onDisconnected);
        log('Connecting to GATT Server...');
        server = await device.gatt.connect();
    } catch (e) {
        msg.error('Failed to connect');
        log(e.message);
        return;
    }

    try {
        log('Getting Furby Service...');
        const service = await server.getPrimaryService(fluff_service);
    
        log('Getting Furby Characteristics...');
        const characteristics = await service.getCharacteristics();
    
        // put handles to characteristics into chars object
        for (const characteristic of characteristics) {
            var uuid = characteristic.uuid;
            var name = uuid_lookup[uuid];
            var props = '';
            for (let k in characteristic.properties) {
                if (characteristic.properties[k]) props += k + ' ';
            }
            log('> Got Characteristic: ' + uuid + ' - ' + name + ' (' + props + ')');
            furby_chars[name] = characteristic;
        }
        // enable notifications
        furby_chars.GeneralPlusListen.addEventListener('characteristicvaluechanged', handleGeneralPlusResponse);
        await furby_chars.GeneralPlusListen.startNotifications();

        furby_chars.NordicListen.addEventListener('characteristicvaluechanged', handleNordicNotification);
        await furby_chars.NordicListen.startNotifications();
    } catch (e) {
        msg.error('Failed initialise BLE services');
        log(e.message);
        return;
    }
  
    //await triggerAction(39,4,2,0); // 'get ready'
    gp_listen_callbacks = [];
    startKeepAlive();
    onConnected();
    addGPListenCallback([0x21], onFurbySensorData);
    await checkActiveSlot();

    await setAntennaColor(255,0,0);
    await sleep(600);
    await setAntennaColor(0,255,0);
    await sleep(600);
    await setAntennaColor(0,0,255);
    await sleep(600);


}
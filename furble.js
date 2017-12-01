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

function sendGPCmd(data, prefix) {
    return new Promise((resolve, reject) => {
        //let s = ['Sending data to GeneralPlusWrite', buf2hex(data)];
        //if (prefix)
        //    s.concat([' expecting prefix of ', prefix]);
        //log.apply(null, s);
        let hnd = addGPListenCallback(prefix, buf => {
            removeGPListenCallback(hnd);
            resolve(buf);
        });
        furby_chars.GeneralPlusWrite.writeValue(new Uint8Array(data)).catch(error => {
            removeGPListenCallback(hnd);
            reject(error);
        });
    });
}

function addGPListenCallback(prefix, fn) {
    let handle = gp_listen_callbacks.length;
    gp_listen_callbacks[handle] = [fn, prefix];
    return handle;
}

function removeGPListenCallback(handle) {
    delete gp_listen_callbacks[handle];
}

function handleGeneralPlusResponse(event) {
    let buf = event.target.value;
    if (buf.getUint8(0) != 0x22) // don't spam log with ImHereSignal keepalive responses
        log('Got GeneralPlus response', buf);
    
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
    return sendGPCmd(data);
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

    // 720000200000002000 slot 13 loaded+active (3)
    // 720000200000000000 slot 13 not active (2)
    // 7200003c0000000000 slots 10,11,12,13 state 2
    // 7200003e0000000000 slots 9,10,11,12,13 state 2
    // 7200003f0000000000 slots 8+ state 2
    // 7200003f8000000000 slots 7+ state 2
    // 7200003fc000000000 slots 6+ state 2
    // 7200003ff800000000 slots 3+ state 2
    log('dlc info: ', buf);
    return buf;
}

async function getAllDLCInfo() {
    let allSlotsInfo = await getDLCInfo();
    console.log(allSlotsInfo);
    var slots = [];
    for (let i=0; i<14; i++) {
        slots[i] = await getDLCSlotInfo(i);
    }
    for (let i=0; i<slots.length; i++)
        log(`slot ${i}: ` + buf2hex(slots[i])); 
}

function getDLCSlotInfo(slot) {
    return sendGPCmd([0x73], [0x73]);
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
    log('Firmware version ', buf.getUint8(1));
    return buf;
}

async function setAntennaColor(r, g, b) {
    log(`Setting antenna color to (${r}, ${g}, ${b})`);
    let buf = await sendGPCmd([0x14, r, g, b]);
}

function cycleDebug() {
    sendGPCmd([0xdb]);
}

function startKeepAlive() {
    return setInterval(async () => {
        if (isTransferring) return;
        let buf = await sendGPCmd([0x20, 0x06], [0x22]);
        //log('Got ImHereSignal', buf);
    }, 3000);
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

async function fetchAndUploadDLC(dlcurl) {
    let response = await fetch(dlcurl);
    log('Fetched DLC from server');
    let buf = await response.arrayBuffer();
    var progress = document.getElementById('dlcprogress');
    progress.max = buf.byteLength;
    try {
        progress.style.display = 'block';
        progress.removeAttribute('value');
        let c = 0;
        log('Clearing all DLC slots...');
        //await deleteAllDLCSlots();
        await sendGPCmd([0xcd, 0]); // eyes off, save battery
        await setAntennaColor(0,0,0);
        let name = 'TU' + Math.floor(Math.random()*10000).toString().padStart(6,'0') + '.DLC';
        await uploadDLC(buf, name, (current, total) => {
            if (c % 100 == 0) 
                progress.value = current;
            if (c % 500 == 0)
                console.log(`transfer: ${current}/${total}`);
            c++;
        });
    } catch (e) {
        log('Download failed');
        console.log(e);
    } finally {
        await sendGPCmd([0xcd, 1]); // eyes on
        await setAntennaColor(0,255,0);
        let buf = getDLCInfo();
        progress.style.display = 'none';
    }
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
                    sendPos += chunk.byteLength;
                    if (progresscb)
                        progresscb(sendPos, size);
                    if (sendPos < size)
                        setTimeout(transferNextChunk, 1);
                    else 
                        log('Sent final packet');
                }).catch(error => {
                    //isTransferring = false;
                    //removeGPListenCallback(hnd)
                    log('FileWrite.writeValue failed, will retry');
                    console.log(error);
                    setTimeout(transferNextChunk, 16);
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
                //log(`NordicListen GotPacketAck ${rxPackets}`);
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
    clearInterval(keepAliveTimer);
    isConnected = false;
    document.getElementById('connbtn').textContent = 'Connect';
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
    return new Promise((resolve, reject) => {
        setTimeout(resolve, t);
    });
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
        log('failed to connect device: ' + e.message);
        console.log(e);
        return;
    }

    isConnected = true;
    document.getElementById('connbtn').textContent = 'Disconnect';

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

    keepAliveTimer = startKeepAlive();
    furby_chars.NordicListen.addEventListener('characteristicvaluechanged', handleNordicNotification);
    await furby_chars.NordicListen.startNotifications();

    await triggerAction(39,4,2,0); // 'get ready'

    for (let i=0; i < 3; i++) {
        setAntennaColor(255,0,0);
        await sleep(0.2);
        setAntennaColor(0,255,0);
        await sleep(0.2);
        setAntennaColor(0,0,255);
        await sleep(0.2);
    }
}
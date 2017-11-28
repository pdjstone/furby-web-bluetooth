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

var device;
var isConnected = false;

var uuid_lookup = {};
for (var name in furby_uuids) {
  var uuid = furby_uuids[name];
  uuid_lookup[uuid] = name;
}

var file_transfer_lookup = {};
for (var mode in file_transfer_modes) {
    file_transfer_lookup[file_transfer_modes[mode]] = mode;
}

var furby_chars = {};

var gp_listen_callbacks = [];

function log() {
    bits = []
    for (let arg of arguments) {
        if (Uint8Array.prototype.isPrototypeOf(arg))
            bits.push(buf2Hex(arg))
        else
            bits.push(''+arg)
    }
    console.log(bits.join(' '));
}
function sendGPCmd(data, prefix) {
    furby_chars.GeneralPlusWrite.writeValue(new Uint8Array(data));
    var s = ['Sending data to GeneralPlusWrite', data]
    if (prefix)
        s.push([' expecting prefix of ', prefix]);
    log.apply(s);
    return new Promise((resolve, reject) => {
        let hnd = addGPListenCallback(buf => {
            removeGPListenCallback(hnd);
            resolve(buf);
        }, prefix);
    });
}


function addGPListenCallback(fn, prefix) {
    var handle = gp_listen_callbacks.length;
    gp_listen_callbacks[handle] = [fn, prefix];
    return handle;
}

function removeGPListenCallback(handle) {
    delete gp_listen_callbacks[handle];
}

function triggerAction(input, index, subindex, specific) {
    if (!index)
        data = [0x10, 0, input];
    else if (!subindex)
        data = [0x11, 0, input, index];
    else if (!specific)
        data = [0x12, 0, input, index, subindex];
    else 
        data = [0x13, 0, input, index, subindex, speicifc];
    return sendGPCmd(data);
}

async function loadDLC(slot) {
    let buf = await sendGPCmd([0x60, slot], [0xdc]);
}

async function activateDLC(slot) {
    let buf = await sendGPCmd([0x61, slot], [0xdc]);
}

async function deactivateDLC(slot) {
    let buf = await sendGPCmd([0x62, slot], [0xdc]);
}

async function getDLCInfo() {
    let buf = await sendGPCmd([0x72], [0x72]);
}

async function getDLCSlotInfo(slot) {
    let buf = await sendGPCmd([0x73], [0x73]);
}

async function deleteDLC(slot) {
    let buf = await sendGPCmd([0x74], [0x74]);
}

async function getFirmwareVersion() {
    let buf = await sendGPCmd([0xfe], [0xfe]);
}

async function setAntennaColor(r,g,b) {
    let buf = await sendGPCmd([0x14, r, g, b]);
}

function cycleDebug() {
    sendGPCmd([0xdb]);
}

async function fetchAndUploadDLC(dlcurl) {
    let response = await fetch(dlcurl);
    let buf = await response.arrayBuffer();
    let c = 0;
    try {
        await uploadDLC(buf, 'DLC1234.DLC', (current, total) => {
            if (c++ % 100 == 0)
                log(`transfer: ${current}/${total}`);
        });
    } catch (e) {
        log('Upload DLC error: ', e);
    }

}
var encoder = new TextEncoder('utf-8');

function uploadDLC(dlcbuf, filename, progresscb) {
    let size = dlcbuf.byteLength;
    let initcmd = [0x50, 0x00, 
        size >> 16 & 0xff, size >> 8 & 0xff, size & 0xff, 
        2];
    initcmd = initcmd.concat(Array.from(encoder.encode(filename)));
    initcmd = initcmd.concat([0,0]);
    let isTransferring = false;
    let sendPos = 0;
    let chunkSize = 20;
    let transferNextChunk = function() {
        if (!isTransferring)
            return;
        var chunk = dlcbug.slice(sendPos, sendPos + chunkSize);
        sendPos += chunk.byteLength;
        if (chunk.byteLength > 0) {
            furby_chars.FileWrite.writeValue(chunk);
            progresscb(sendPos, size);
            setTimeout(transferNextChunk, 16);
        } else {
            isTransferring = false;
        }
    }
    return new Promise((resolve, reject) => {
        let hnd = addGPListenCallback((buf) => {
            let fileMode = buf.getUint8(1);
            log('Got FileWrite callback: ' + file_transfer_modes[fileMode]);
            if (fileMode == file_transfer_lookup.FileTransferTimeout ||
                fileMode == file_transfer_lookup.FileReceivedErr) {
                isTransferring = false;
                removeGPListenCallback(hnd);
                reject('File Transfer error');
            } else if (fileMode == file_transfer_lookup.FileReceivedOk) {
                isTransferring = false;
                removeGPListenCallback(hnd);
                resolve();
            } else if (fileMode == file_transfer_lookup.ReadyToReceive) {
                isTransferring = true;
                transferNextChunk();
            }
        }, [0x24]);
        log('Sending init DLC: ', initcmd);
        furby_chars.GeneralPlusWrite.writeValue(new Uint8Array(initcmd));
    });
    

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

function onDisconnected() {
    log('> Bluetooth Device disconnected');
    isConnected = false;
    document.getElementById('connbtn').textContent = 'Connect';
}

function handleGeneralPlusResponse(event) {
    let buf = event.target.value;
    for (let handle in gp_listen_callbacks) {
        [cb, prefix] = gp_listen_callbacks[handle];
        if (prefixMatches(prefix, buf))
            cb(buf);
    }
}

function buf2hex(dv) {
    var s = '';
    if (Uint8Array.prototype.isPrototypeOf(dv)) {
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
    if (isConnected) {
      doDisconnect();
    } else {
      doConnect();
    }
}

async function doDisconnect() {
    try {
      log('Disconnecting from GATT Server...');
      device.gatt.disconnect();
    } catch (e) {
      log('Argh! ' + e);
    }
  }

async function doConnect() {
    try {
      log('Requesting Bluetooth Devices with Furby name...');
  
      device = await navigator.bluetooth.requestDevice({
          filters: [{ name: 'Furby'}], 
          optionalServices: ['generic_access', 'device_information', fluff_service]});
  
      device.addEventListener('gattserverdisconnected', onDisconnected);
  
      log('Connecting to GATT Server...');
      const server = await device.gatt.connect();
  
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
        for (k in characteristic.properties) {
          if (characteristic.properties[k]) props += k + ' ';
        }
        log('> Got Characteristic: ' + uuid + ' - ' + name + ' (' + props + ')');
        furby_chars[name] = characteristic;
      }
  
      // enable notifications
      chars.GeneralPlusListen.addEventListener('characteristicvaluechanged', handleGeneralPlusResponse);
      await chars.GeneralPlusListen.startNotifications();
  
      chars.NordicListen.addEventListener('characteristicvaluechanged', handleNordicNotification);
      await chars.NordicListen.startNotifications();

    } catch(error) {
      log('Argh! ' + error);
    }
  }
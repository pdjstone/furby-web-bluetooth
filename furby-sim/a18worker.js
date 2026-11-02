importScripts('a1800.js');
onmessage = e => {
  const { id, buf } = e.data;
  try {
    const pcm = decodeA18(new Uint8Array(buf));
    postMessage({ id, pcm }, [pcm.buffer]);
  } catch (err) {
    postMessage({ id, error: String(err) });
  }
};

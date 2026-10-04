export async function onebotCall(action, body, { url = process.env.ONEBOT_HTTP_URL || 'http://127.0.0.1:3000', token = process.env.ONEBOT_ACCESS_TOKEN, signal } = {}) {
  const response = await fetch(`${url.replace(/\/$/, '')}/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body), signal: AbortSignal.any([AbortSignal.timeout(action === 'upload_group_file' ? 120000 : 15000),...(signal?[signal]:[])])
  });
  if (!response.ok) throw new Error('OneBot request failed');
  const result=await response.json();
  if(result.retcode!==0)throw new Error('OneBot request failed');
  return result.data;
}

export async function sendAudio(event, audio, options) {
  await onebotCall('upload_group_file', { group_id: event.group_id, file: audio.path, name: audio.name }, options);
}

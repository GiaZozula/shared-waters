import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

// Fixed provider origins prevent credentials being sent to a configured arbitrary URL.
export async function deployRender({ token, serviceId, sha, githubToken, repository,
  request = fetch, wait = delay, now = Date.now, timeoutMs = 15 * 60_000, preflightOnly = false }) {
  if (!token || !/^srv-[a-z0-9]+$/.test(serviceId ?? '') || !/^[a-f0-9]{40}$/.test(sha ?? '') ||
      !githubToken || repository !== 'GiaZozula/shared-waters') throw new Error('Missing or invalid deployment configuration.');
  const render = async (path, body) => {
    const response = await request(`https://api.render.com/v1/services/${serviceId}${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`Render request failed (${response.status}); inspect privately.`);
    return response.json();
  };
  const service = await render('');
  if (service.autoDeploy !== 'no' || service.branch !== 'main' || service.type !== 'web_service' ||
      service.repo !== `https://github.com/${repository}` || service.serviceDetails?.plan !== 'free') {
    throw new Error('Expected the existing Free main-branch service with auto-deploy disabled.');
  }
  const head = await request(`https://api.github.com/repos/${repository}/git/ref/heads/main`, {
    redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json' },
  });
  if (!head.ok || (await head.json()).object?.sha !== sha) throw new Error('Commit is no longer main HEAD; rerun the latest successful checks.');
  if (preflightOnly) return { sha };
  const deployment = await render('/deploys', { commitId: sha, clearCache: 'do_not_clear' });
  if (!/^dep-[a-z0-9]+$/.test(deployment.id ?? '')) throw new Error('Invalid Render deployment response.');
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const state = await render(`/deploys/${deployment.id}`);
    if (state.commit?.id !== sha) throw new Error('Render deployment commit does not match the checked commit.');
    if (state.status === 'live') return { id: deployment.id, sha };
    if (['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled', 'deactivated'].includes(state.status)) {
      throw new Error(`Render deployment ended with ${state.status}; previous compatible code/schema must be retained.`);
    }
    await wait(15_000);
  }
  throw new Error('Deployment wait expired; inspect Render before retrying or rolling back.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await deployRender({ token: process.env.RENDER_API_KEY, serviceId: process.env.RENDER_SERVICE_ID,
      sha: process.env.GITHUB_SHA, githubToken: process.env.GITHUB_TOKEN, repository: process.env.GITHUB_REPOSITORY,
      preflightOnly: process.argv.includes('--preflight') });
    if (process.argv.includes('--preflight')) {
      console.log('Render service and main commit preflight passed.');
      process.exit(0);
    }
    console.log(`Render deployment live: ${result.sha} (${result.id}).`);
    const response = await fetch('https://api.shared-waters.giazozula.com/api/wake', {
      redirect: 'error', signal: AbortSignal.timeout(90_000),
    });
    const body = response.ok && response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
    if (body?.service !== 'shared-waters' || body.api !== 'connected' || body.database !== 'connected') {
      throw new Error('Post-deploy API/database acceptance failed; inspect privately.');
    }
    console.log('Post-deploy API/database acceptance passed; no model/AIS request made.');
  } catch (error) {
    // Only deliberate local messages are safe to print; transport errors may contain credentials.
    console.error(error instanceof Error && /^(Render |Expected |Commit |Invalid |Deployment |Missing |Post-deploy )/.test(error.message)
      ? error.message : 'Deployment transport failed; inspect privately before retrying.');
    process.exitCode = 1;
  }
}

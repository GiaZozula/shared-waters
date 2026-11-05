type Source = { name: string; use: string; url: string };
type Decision = { title: string; choice: string; alternative: string; tradeoff: string };

const stack = [
  { title: 'Frontend', items: ['TypeScript', 'Three.js', 'HTML and CSS', 'Vite', 'SunCalc'] },
  { title: 'Backend', items: ['Node.js', 'Fastify', 'PostgreSQL', 'Neon', 'DeepSeek', 'WebSockets and ws'] },
  { title: 'Delivery', items: ['Cloudflare Pages', 'Render', 'Netlify DNS', 'GitHub Actions', 'Docker and Compose'] },
  { title: 'Testing and monitoring', items: ['Node test runner and tsx', 'Grafana and Render logs'] },
];

const sources: Source[] = [
  { name: 'Global Fishing Watch', url: 'https://globalfishingwatch.org/', use: 'Historical vessel activity and speed categories for Story.' },
  { name: 'WHOI / Robots4Whales', url: 'https://dcs.whoi.edu/dal2606/dal2606_sable.shtml', use: 'Reviewed right whale detections for Story and Live.' },
  { name: 'Canadian Coast Guard NAVWARN', url: 'https://nis.ccg-gcc.gc.ca/public/rest/menu/en/topics', use: 'Protection notices for the timeline and current zone context.' },
  { name: 'AISStream', url: 'https://aisstream.io/', use: 'Recent vessel positions for Live.' },
  { name: 'Open-Meteo Marine', url: 'https://open-meteo.com/en/docs/marine-weather-api', use: 'Modelled sea and weather conditions for Live.' },
];

const original: Decision[] = [
  { title: 'One zone and a bounded historical case', choice: 'Validate the available whale, vessel and notice records before committing to a scene. Focus on Zone A so the data could support a coherent experience within three days.', alternative: 'A broader wildlife explorer, green crab reports or gull movement data.', tradeoff: 'A focused case was achievable within the deadline, but exploring other zones or periods requires new data preparation and interface work.' },
  { title: 'One TypeScript backend and a relational database', choice: 'Use Fastify and PostgreSQL for collection, storage and time-bounded queries, with TypeScript across the application.', alternative: 'A separate Python backend, a larger application framework or serverless collection.', tradeoff: 'Fewer language and deployment boundaries during the deadline. Collection shares the server lifecycle, and long-lived work needs explicit ownership if processes multiply.' },
  { title: 'Three.js with HTML controls', choice: 'Make the scene the main visual experience and retain DOM controls for text and interaction. The unused React layer was removed during the build.', alternative: 'Keep React around the scene or present the sources as a conventional dashboard.', tradeoff: 'Fewer interface layers to maintain, but more custom interaction, accessibility and rendering work than a conventional dashboard.' },
  { title: 'Derive replay frames in the browser', choice: 'Load a bounded historical dataset and derive the selected Story frame locally. Scrubbing does not fetch an upstream source or call the LLM.', alternative: 'Request a new frame from the server whenever the selected time changes.', tradeoff: 'Scrubbing avoids a server round trip, but the browser must download and hold the dataset. Larger periods would need a different loading strategy.' },
  { title: 'Let the LLM select tools', choice: 'Expose bounded read tools and let application code compute and format the facts. Resolve evidence references before returning an answer.', alternative: 'Free-form generated answers, arbitrary SQL or open web browsing.', tradeoff: 'Predictable queries and answers, but each new kind of question needs a tool, validation and application formatting.' },
  { title: 'Preserve source distinctions', choice: 'Keep source-specific records, provenance and separate clocks rather than forcing every feed into the same record shape.', alternative: 'Convert every feed into one shared record shape at ingestion.', tradeoff: 'Source details remain available for queries and display, but each adapter and cross-source comparison needs more specific handling.' },
  { title: 'Bound what could be verified in 72 hours', choice: 'Deliver the historical case, other feeds, grounded questions and the scene within the submission window. AIS collection code existed, but public AIS was unconfigured at submission.', alternative: 'Spend the final hours establishing live vessel coverage or extending the feature set.', tradeoff: 'More time went to the historical experience and questions, while public AIS setup and broader browser testing were deferred.' },
];

const later: Decision[] = [
  { title: 'Deliver Story independently of the API', choice: 'Export a reviewed static snapshot and serve it with the interface from Cloudflare Pages. Keep the API for dynamic reads and broader questions.', alternative: 'Require the backend to serve every Story visit.', tradeoff: 'Historical playback and archive evidence survive backend unavailability. The snapshot must be regenerated deliberately, and separate frontend and API delivery require compatible contracts.' },
  { title: 'Keep modest hosting and make cold starts visible', choice: 'Use Render and Neon with an interface that loads first, a bounded readiness check and clear unavailable states.', alternative: 'Pay for an always-on backend or introduce a different hosting arrangement.', tradeoff: 'Lower ongoing hosting cost, with wake delays, service quotas and gaps in collection while the backend sleeps.' },
  { title: 'Collect AIS within a shared allowance', choice: 'Collect in response to visible reader demand, with session, cooldown, storage and daily bounds. Reserve each 15-minute session against a six-hour shared UTC-day allowance.', alternative: 'Run continuous collection or account for every disconnected second with refunds.', tradeoff: 'Simple reservation accounting bounds collection time, but early disconnects still consume a full session and collection gaps miss incoming reports.' },
  { title: 'Reuse PostgreSQL for public model limits', choice: 'Check durable frequency, concurrency and total admission limits before contacting the provider. An admitted call stays spent even if it fails.', alternative: 'Use only in-memory limits or add a separate rate-limit service.', tradeoff: 'Limits survive restarts without another service, but admission adds database transactions. Database failure pauses model questions, and crashed reservations can need manual reconciliation.' },
  { title: 'Give collection one owner', choice: 'Use a dedicated PostgreSQL session advisory lock to select a collector. Separate API and worker roles are implemented, while production remains one combined process.', alternative: 'Let every process collect independently or implement an expiring lease row.', tradeoff: 'Reusing PostgreSQL avoids another coordination service, but requires a dedicated direct connection and careful shutdown on ownership loss. Brief in-flight upstream overlap remains possible during failure recovery.' },
  { title: 'Automate delivery and rehearse recovery', choice: 'Check compiled artifacts and isolated databases before trusted backend deployment. Keep migrations deliberate and verify saved backups in a disposable restore environment.', alternative: 'Rely on manual deployment and an untested backup file.', tradeoff: 'Repeatable delivery and tested restore steps require more pipeline maintenance, CI time and backup storage.' },
  { title: 'Keep monitoring private and bounded', choice: 'Send operational metrics while the backend is awake and retain diagnostic information in private logs. The public Status panel shows service and source state.', alternative: 'Expose logs publicly or add continuous external probing.', tradeoff: 'Reusing hosted logs and sending metrics while awake keeps monitoring modest, but leaves gaps during sleep and ties log retention to the hosting provider.' },
];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}

export function mountSystemReference(root: HTMLElement) {
  const stackSection = element('section');
  stackSection.className = 'architecture-reference';
  const groups = element('div');
  groups.className = 'architecture-stack-groups';
  for (const group of stack) {
    const column = element('div');
    const list = element('ul');
    list.className = 'architecture-stack';
    for (const name of group.items) list.append(element('li', name));
    column.append(element('h3', group.title), list);
    groups.append(column);
  }
  stackSection.append(element('h2', 'Stack and services'), groups);

  const sourceSection = element('section');
  sourceSection.className = 'architecture-reference';
  const sourceList = element('ul');
  sourceList.className = 'architecture-sources';
  for (const source of sources) {
    const item = element('li');
    const link = element('a', source.name);
    link.href = source.url;
    item.append(link, ` - ${source.use}`);
    sourceList.append(item);
  }
  sourceSection.append(element('h2', 'Data sources'), sourceList);
  root.append(stackSection, sourceSection);
  const section = element('section');
  section.className = 'architecture-reference architecture-decisions';
  section.append(element('h2', 'Decisions and tradeoffs'), element('p', 'The original deadline shaped a small evidence explorer. Subsequent work developed its delivery, operating limits and reliability. Expand a choice to see the reasoning and its cost.'));
  for (const [title, entries] of [['The 72-hour build', original], ['Developing it further', later]] as const) {
    section.append(element('h3', title));
    for (const entry of entries) {
      const details = element('details');
      details.append(element('summary', entry.title));
      const body = element('div');
      for (const [label, text] of [['Choice', entry.choice], ['Alternative', entry.alternative], ['Tradeoff', entry.tradeoff]]) {
        body.append(element('h4', label), element('p', text));
      }
      details.append(body);
      section.append(details);
    }
  }
  root.append(section);
}

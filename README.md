# Shared Waters
**[Explore the live project here.](https://shared-waters.giazozula.com/)** 
<br>

Shared Waters is an interactive look at vessel activity, North Atlantic right whale detections, and marine protections in the Gulf of St. Lawrence.

<img width="1457" height="728" alt="Screenshot 2026-11-05 at 10 14 33 AM" src="https://github.com/user-attachments/assets/ebc2989e-7d2f-4229-8801-8139d72fad33" />


<img width="1457" height="792" alt="Screenshot 2026-11-05 at 10 00 25 AM" src="https://github.com/user-attachments/assets/971f8451-f429-4bf8-a7ca-e27d1d018aba" />


## Origin & Concept

Shared Waters began as a 72-hour technical exercise to build a deployed demo with natural-language input, three or more real-time feeds, timeline replay, and a technology new to me.

While exploring vessel and whale records, I noticed slower vessel activity near a whale detection. That observation led me to learn more about Canada’s protection measures and shaped the project.

I chose to focus on the endangered North Atlantic Right Whale in the hope of sparking curiosity about the animals and the industrial and legal systems around them.

<img width="1457" height="792" alt="Screenshot 2026-11-05 at 10 03 15 AM" src="https://github.com/user-attachments/assets/abf957b5-b559-4d9d-a97f-6eb2295ab0ff" />
<img width="1457" height="792" alt="Screenshot 2026-11-05 at 10 13 55 AM" src="https://github.com/user-attachments/assets/08def6f9-0f20-453a-a85a-f6f12a47a61b" />


## Architecture
You can find detailed explanations, including animated walkthroughs of various parts of the system, [here](https://shared-waters.giazozula.com/system).

This diagram is a high level overview of the system.

<img width="946" height="692" alt="Screenshot 2026-11-05 at 9 46 46 AM" src="https://github.com/user-attachments/assets/354714b3-c073-4267-b3ba-70a522c28872" />

## Stack
| Category | Technologies |
| :--- | :--- |
| **Frontend** | TypeScript, Three.js, HTML and CSS, Vite, SunCalc |
| **Backend** | Node.js, Fastify, PostgreSQL, Neon, DeepSeek, WebSockets |
| **Delivery** | Cloudflare Pages, Render, Netlify DNS, GitHub Actions, Docker and Compose |
| **Testing & Monitoring** | Node test runner and tsx, Grafana and Render logs |

### Data Sources & Integrations
| Source / Provider | Description |
| :--- | :--- |
| [Global Fishing Watch](https://globalfishingwatch.org/) | Historical vessel activity and speed categories. |
| [WHOI / Robots4Whales](https://dcs.whoi.edu/dal2606/dal2606_sable.shtml) | Reviewed right whale detections. |
| [Canadian Coast Guard NAVWARN](https://nis.ccg-gcc.gc.ca/public/rest/menu/en/topics) | Protection notices providing safety of navigation info, marine activities, and hazards. |
| [AISStream](https://aisstream.io/) | Real-time maritime events and vessel positions streamed via WebSocket. |
| [Open-Meteo Marine API](https://open-meteo.com/en/docs/marine-weather-api) | Modelled sea conditions and hourly marine weather forecasts. |

**Data note:** Coverage, availability, and update frequency vary by provider, so these sources may not describe the same moment or provide a complete picture of activity.

## License

Original application code is licensed under the [MIT License](LICENSE). Third-party data and services remain subject to their respective providers’ licenses and terms; see the sources linked above.

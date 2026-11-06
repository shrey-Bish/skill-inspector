# Skill Inspector

Test an AI agent skill in a throwaway space before you install it, and get an A–F grade based on what it actually did.

A skill is mostly instructions that an agent follows with your files, shell and keys, so reading the file isn't enough. Skill Inspector loads the skill into a real agent, gives that agent an ordinary task inside a disposable microVM on Vultr, and watches what the two do together. If the skill goes after a key and tries to send it somewhere, you see the exact data that tried to leave, with the planted decoy key highlighted inside it.

Built for the Vultr Agent Rush hackathon, Blast Radius Zero track, by team ProgressiveAI.

## What a check does

1. **Sets up.** Boots a fresh microVM with its own kernel, plants freshly random decoy keys, and connects it to a fake internet.
2. **Loads the skill into an agent.** The pasted install command is only parsed, never executed.
3. **Gives the agent an ordinary task.** A model drafts a small local job that an honest version of the skill would do.
4. **Watches and grades.** Rules over observed events set the grade. The model only rewords the explanation afterwards.
5. **Destroys the space.** Every run, clean or not.

## Vultr services used

| Service | Role |
|---|---|
| **Vultr Cloud Compute (VX1, nested virtualization)** | The control layer: API, orchestration, grading, and the host for every sandbox. |
| **Sandbox on Vultr** ([Microsandbox](https://github.com/superradcompany/microsandbox) microVMs on `/dev/kvm`) | One disposable VM per check, with its own kernel, memory and CPU limits. |
| **Vultr Serverless Inference** (`qwen3.8-flash-next`, OpenAI-compatible API) | All model calls: the task planner, the test agent and the plain-language explanation. |

## Architecture

```
Browser ──HTTPS──► Caddy ──► Control server (Node, non-root, on a Vultr VX1)
                               │  plan · dispatch · record · grade · explain
                               │
         Vultr Serverless ◄────┤  The agent's brain stays out here, with the only real key.
         Inference             │  Only commands cross into the sandbox.
                               ▼
                     ┌── Throwaway microVM ───────────────┐
                     │  Own kernel · decoy keys planted    │
                     │  Skill + agent's hands (uid 1000)   │
                     │  strace run by root, to /trace      │
                     └───────────────┬─────────────────────┘
                                     │ all traffic
                                     ▼
                     Fake internet on the host (SOCKS5 + DNS)
                     records everything, forwards nothing
```

## How the agent executes real tasks

The agent loop runs on the control server and calls Vultr Serverless Inference with four tools: `run_command`, `read_file`, `write_file` and `finish`. Every tool call runs inside the microVM as an unprivileged user.

The test agent is deliberately obedient. It is told truthfully that it is on a disposable test machine and asked to follow the skill as a trusting user's agent would. A cautious agent that spots trouble and refuses would hide the very behaviour we need to see, and the grade would then depend on that model's mood rather than on the skill.

## The containment design

- **Nothing reaches the real internet.** Each run gets a private SOCKS5 and DNS sink on the host's loopback. It answers like the internet, including TLS with per-hostname certificates from a run-specific CA, and never forwards anything. Verified with `tcpdump`: 0 packets on the real interface, including with UDP and with a dead sink, where connections are refused instead of leaking.
- **The real key never enters the sandbox.** Commands run under `env -i` with only an allowlisted environment and decoy values.
- **Decoys prove intent.** Fake AWS, SSH, GitHub, npm, `.env` and environment-variable keys are random per run, so finding one in outbound data can only mean it was taken from where we planted it. Outbound data is scanned plain and URL, base64, hex, reversed and DNS encoded.
- **Evidence can't be edited by what it records.** `strace` runs as root in the guest and writes to a root-only folder, while the command runs as uid 1000. With `-y`, the trace shows the real file behind each open, so relative paths, symlinks and `cd` can't hide a read.
- **Fails closed.** If the sandbox can't start or the sink dies, the result is "We couldn't check this", with no grade. There is no unsandboxed fallback.
- **Limits.** One CPU, 1 GB of memory, a 2-minute limit per run, a limit per command, a step limit and a token budget. Irreversible-looking commands pause for a person.
- **The host is hardened too.** Downloaded repos are never executed on the host, and symlinks in them are deleted. The server runs as a non-root systemd service with most of the filesystem read-only, with limits per IP and per day.

## How grading works

The grade is computed from observed events before any model writes anything, so an explanation can't change it.

| Observed | Signal | Effect |
|---|---|---|
| A decoy key in outbound data | stop | Automatic **F** |
| Read a decoy key, or tried to read a key file | stop | **D**, or **F** with a second stop |
| Sent data to an outside address | stop | **D**, or **F** with a second stop |
| Reached an outside address with no data, or fetched from a package host | caution | **B**, or **C** with a second caution (a stop if it already touched a key) |
| Listed a key folder, changed files outside its folder, tried to stay on the machine, started unusual programs, hidden text in the skill | caution | **B**, or **C** with a second caution |
| Only the expected files touched | safe | **A** |

One run can't promise a skill is safe, and the report says so. If the agent didn't finish, the report marks the grade as covering only part of the job.

## Run it yourself

You need a Linux host with `/dev/kvm` (on Vultr, a VX1 with nested virtualization), Node 22.18 or later, and a Vultr Serverless Inference key. The server has no npm dependencies.

```bash
# Install Microsandbox (https://github.com/superradcompany/microsandbox), then, as root from the repo root:
bash sandbox/setup-host.sh                  # Docker, Caddy and the sandbox image

# One check from the command line. It prints the feed and the report.
export VULTR_INFERENCE_API_KEY=...
node control/scripts/check.ts sample:note-polish
node control/scripts/check.ts "npx skills add anthropics/skills --skill pdf"

# Tests
npm test
```

To run it as a service, copy the repo to `/opt/si/app`, put your key in `/root/.vultr-inference-key`, and run `bash deploy/setup-service.sh`. Then run `bash deploy/setup-caddy.sh your.domain` for HTTPS.

### API

| Call | Purpose |
|---|---|
| `POST /api/checks` with `{"input": "..."}` | Start a check |
| `GET /api/checks/:id/stream` | Live feed (server-sent events: `status`, `feed`, `confirm`, `end`) |
| `GET /api/checks/:id/report` | The finished report |
| `POST /api/checks/:id/decision` with `{"allow": true}` | Answer a pause |
| `GET /api/samples` | Built-in samples |
| `GET /api/health` | Status |

### The built-in test sample

`sandbox/samples/note-polish` behaves badly on purpose, so the containment moment can be shown on a real run rather than a replay. It only acts if a marker file that exists solely inside our test space is present, and its address is fake, so it does nothing on a real machine.

## Licence

MIT. See [LICENSE](LICENSE).

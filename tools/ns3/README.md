# ProtoViz ns-3 Simulation Tooling

Offline ns-3 simulations that produce fabric scenario data (`topology.json`
and `frames.json`) for the in-browser replay engine under
`src/components/netsim/`.

These tools run **on WSL** (Windows Subsystem for Linux, Ubuntu 22.04). They
are not built or run as part of the ProtoViz GitHub Pages app — the app
only consumes the committed JSON output.

---

## One-Time Setup (WSL Ubuntu 22.04)

### Install ns-3.40 build dependencies

```bash
sudo apt update
sudo apt install -y \
  g++ python3 python3-dev python3-setuptools python3-pip \
  cmake ninja-build git pkg-config \
  libxml2 libxml2-dev libboost-all-dev \
  libgsl-dev libsqlite3-dev
```

### Clone and build ns-3.40

```bash
cd ~
git clone https://gitlab.com/nsnam/ns-3-dev.git ns-3-dev
cd ns-3-dev
git checkout ns-3.40

./ns3 configure --build-profile=optimized --enable-examples --enable-tests
./ns3 build
```

A successful build takes 10-30 minutes depending on the machine.

### Verify the install

```bash
./ns3 run hello-simulator
# expected output: "Hello Simulator"
```

---

## Running a ProtoViz Scenario

From the ProtoViz repo root on WSL (clone the repo under WSL, not
under `/mnt/c/` — the Windows filesystem is too slow for ns-3 builds):

```bash
# Copy the scenario source into the ns-3 scratch directory
cp tools/ns3/scenarios/pfc_storm.cc ~/ns-3-dev/scratch/

# Build + run with both variants
cd ~/ns-3-dev
./ns3 run "scratch/pfc_storm --variant=pfc_enabled  --outdir=/path/to/protoviz/public/netsim/pfc-storm"
./ns3 run "scratch/pfc_storm --variant=pfc_disabled --outdir=/path/to/protoviz/public/netsim/pfc-storm"
```

The scenario writes `frames_pfc_enabled.json` and `frames_pfc_disabled.json`
directly into the ProtoViz `public/netsim/pfc-storm/` directory.

---

## Scenario Script Conventions

Each scenario is a standalone C++ file in `tools/ns3/scenarios/`. It must:

1. **Accept `--variant=<name>` and `--outdir=<path>`** on the command line
2. **Match the topology defined in** `public/netsim/<scenario>/topology.json`
   — same node ids, same link ids, same capacities
3. **Sample at 100ms intervals** for `duration_ms` (from topology.json)
4. **Emit `frames_<variant>.json`** with the schema documented in
   `public/netsim/README.md` (links, flows, nodes with state)
5. **Stay under 2 MB** per output file — downsample to 250ms intervals if a
   longer simulation is needed

Link ids in the scenario's C++ code must match the ids in topology.json
exactly. The frontend assumes a 1:1 mapping.

---

## Adding a New Scenario

1. Create `public/netsim/<scenario-id>/topology.json` (see existing PFC
   Storm for reference). Include the `packet_scenario` field on every
   link — it should reference an existing ProtoViz YAML scenario slug.
2. Create `tools/ns3/scenarios/<scenario_name>.cc` — a standalone ns-3
   scenario that matches the topology and emits `frames_<variant>.json`
   files.
3. Add the scenario entry to `public/netsim/index.json`.
4. Run the simulation and commit the generated JSON files.
5. Add a new scenario card — it will appear in the "Fabric Scenarios"
   family on the gallery automatically.

---

## Notes on ns-3 Fidelity

ns-3 is a packet-level discrete-event simulator. It accurately models:

- Queueing, drops, and buffer sizes
- TCP congestion control (DCTCP, CUBIC, etc.)
- ECMP and routing
- PFC pause propagation (when combined with the `queue-disc-pfc-enabled`
  patch or a custom queue discipline)
- FlowMonitor statistics (throughput, delay, loss)

It does **not** model:

- RoCEv2 BTH/RETH semantics at the transport level (ns-3 has no native
  RoCE — we simulate as UDP with PFC)
- Hardware-specific DCQCN parameter tuning
- NIC-specific buffer management

Scenarios should note these limitations in their narrative text so users
don't misinterpret the simulation as a vendor-specific prediction.

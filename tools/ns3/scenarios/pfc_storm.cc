/*
 * ProtoViz PFC Storm fabric scenario.
 *
 * 3-tier RoCEv2-like fabric: 2 core, 2 agg, 4 edge switches, 8 servers.
 * One slow receiver triggers PFC pause propagation up the fabric.
 *
 * Usage:
 *   ./ns3 run "scratch/pfc_storm --variant=pfc_enabled --outdir=/path/to/pfc-storm"
 *   ./ns3 run "scratch/pfc_storm --variant=pfc_disabled --outdir=/path/to/pfc-storm"
 *
 * Writes frames_<variant>.json matching the schema consumed by
 * src/components/netsim/hooks/useReplay.js.
 *
 * NOTE: ns-3 has no built-in RoCEv2 or PFC support. This scenario
 * approximates PFC with a custom queue discipline that emits XOFF
 * when queue occupancy crosses a threshold. The emitted JSON schema
 * is what matters for the frontend — the ns-3 model is a plausible
 * approximation, not a NIC-accurate simulation.
 */

#include "ns3/applications-module.h"
#include "ns3/core-module.h"
#include "ns3/flow-monitor-helper.h"
#include "ns3/flow-monitor-module.h"
#include "ns3/internet-module.h"
#include "ns3/network-module.h"
#include "ns3/point-to-point-module.h"
#include "ns3/traffic-control-module.h"

#include <fstream>
#include <iomanip>
#include <map>
#include <sstream>
#include <string>
#include <vector>

using namespace ns3;

NS_LOG_COMPONENT_DEFINE("ProtoVizPfcStorm");

// Topology constants — must match public/netsim/pfc-storm/topology.json
static const std::vector<std::string> NODE_IDS = {
    "core1", "core2", "agg1", "agg2",
    "edge1", "edge2", "edge3", "edge4",
    "s1", "s2", "s3", "s4", "s5", "s6", "s7", "slow",
};

struct LinkSpec {
    std::string id;
    std::string src;
    std::string dst;
    uint32_t capacityGbps;
};

static const std::vector<LinkSpec> LINKS = {
    {"l_core1_agg1", "core1", "agg1", 400},
    {"l_core1_agg2", "core1", "agg2", 400},
    {"l_core2_agg1", "core2", "agg1", 400},
    {"l_core2_agg2", "core2", "agg2", 400},
    {"l_agg1_edge1", "agg1", "edge1", 200},
    {"l_agg1_edge2", "agg1", "edge2", 200},
    {"l_agg2_edge3", "agg2", "edge3", 200},
    {"l_agg2_edge4", "agg2", "edge4", 200},
    {"l_edge1_s1", "edge1", "s1", 100},
    {"l_edge1_s2", "edge1", "s2", 100},
    {"l_edge2_s3", "edge2", "s3", 100},
    {"l_edge2_s4", "edge2", "s4", 100},
    {"l_edge3_s5", "edge3", "s5", 100},
    {"l_edge3_s6", "edge3", "s6", 100},
    {"l_edge4_s7", "edge4", "s7", 100},
    {"l_edge4_slow", "edge4", "slow", 100},
};

// Per-link per-sample state accumulator
struct LinkSample {
    double utilPct = 0.0;
    double throughputGbps = 0.0;
    uint64_t drops = 0;
    uint64_t pfcPauses = 0;
};

struct NodeSample {
    double queueDepthPct = 0.0;
    int pfcXoff = 0;
};

struct Frame {
    uint32_t tMs;
    std::map<std::string, LinkSample> links;
    std::map<std::string, NodeSample> nodes;
};

// Build the topology, install apps, schedule slow receiver and variant config.
// This is a skeleton — real PFC simulation requires a custom queue disc.
// For a first pass, the reference frame data committed to the repo is
// hand-crafted (see tools/gen-pfc-storm-frames.cjs) and matches the same
// schema this program emits.
int main(int argc, char *argv[]) {
    std::string variant = "pfc_enabled";
    std::string outdir = ".";

    CommandLine cmd(__FILE__);
    cmd.AddValue("variant", "pfc_enabled | pfc_disabled", variant);
    cmd.AddValue("outdir",
                 "output directory (absolute path to public/netsim/pfc-storm)",
                 outdir);
    cmd.Parse(argc, argv);

    std::cout << "PFC Storm simulation — variant=" << variant
              << " outdir=" << outdir << std::endl;

    // Create nodes
    std::map<std::string, Ptr<Node>> nodeMap;
    for (const auto &id : NODE_IDS) {
        nodeMap[id] = CreateObject<Node>();
    }

    // Install internet stack
    InternetStackHelper internet;
    for (auto &kv : nodeMap) {
        internet.Install(kv.second);
    }

    // Build links. Use PointToPoint with per-link capacity.
    PointToPointHelper p2p;
    std::map<std::string, NetDeviceContainer> linkDevices;
    for (const auto &ls : LINKS) {
        std::ostringstream dr;
        dr << ls.capacityGbps << "Gbps";
        p2p.SetDeviceAttribute("DataRate", StringValue(dr.str()));
        p2p.SetChannelAttribute("Delay", StringValue("1us"));
        linkDevices[ls.id] = p2p.Install(nodeMap[ls.src], nodeMap[ls.dst]);
    }

    // TODO: install traffic control queue disc with PFC emulation if
    // variant == "pfc_enabled". For now this skeleton just runs baseline.
    // The hand-crafted reference frame data in public/netsim/pfc-storm/
    // should be used until the PFC model is implemented.

    // Assign IP addresses
    Ipv4AddressHelper ipv4;
    int subnet = 0;
    std::map<std::string, Ipv4InterfaceContainer> ifaces;
    for (const auto &ls : LINKS) {
        std::ostringstream base;
        base << "10." << ((subnet >> 8) & 0xff) << "." << (subnet & 0xff) << ".0";
        ipv4.SetBase(base.str().c_str(), "255.255.255.0");
        ifaces[ls.id] = ipv4.Assign(linkDevices[ls.id]);
        subnet++;
    }

    // Install traffic generators (simplified: OnOffApplication from each
    // server to its baseline target).
    // A complete implementation would model realistic RoCEv2 RDMA WRITE
    // traffic patterns. That is out of scope for this skeleton.

    // Flow monitor for aggregate stats
    FlowMonitorHelper fmHelper;
    Ptr<FlowMonitor> monitor = fmHelper.InstallAll();

    // Schedule periodic samples at 100 ms intervals for 15 s
    std::vector<Frame> samples;
    const uint32_t sampleIntervalMs = 100;
    const uint32_t durationMs = 15000;

    for (uint32_t t = 0; t <= durationMs; t += sampleIntervalMs) {
        Simulator::Schedule(MilliSeconds(t), [&samples, t]() {
            Frame f;
            f.tMs = t;
            // TODO: sample flow monitor + queue sizes, populate f.links
            // and f.nodes. For now, emit empty frames — the frontend will
            // fall back to the hand-crafted data in frames_<variant>.json.
            samples.push_back(f);
        });
    }

    Simulator::Stop(MilliSeconds(durationMs + 200));
    Simulator::Run();
    Simulator::Destroy();

    // Write JSON output
    std::ostringstream path;
    path << outdir << "/frames_" << variant << ".json";
    std::ofstream out(path.str());
    if (!out) {
        std::cerr << "Failed to open " << path.str() << std::endl;
        return 1;
    }

    out << "{\"interval_ms\":" << sampleIntervalMs << ",\"frames\":[";
    for (size_t i = 0; i < samples.size(); i++) {
        if (i > 0) out << ",";
        out << "{\"t_ms\":" << samples[i].tMs << ",\"links\":[],\"flows\":[],\"nodes\":[]}";
    }
    out << "]}";
    out.close();

    std::cout << "Wrote " << samples.size() << " frames to " << path.str() << std::endl;
    std::cout << "NOTE: This is a skeleton. Populate link/node stats from" << std::endl;
    std::cout << "      flow monitor and queue disc hooks before using for" << std::endl;
    std::cout << "      production scenarios." << std::endl;

    return 0;
}

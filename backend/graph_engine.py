import networkx as nx

ALLOWED_TYPES = {'objective','endpoint','procedure','visit','eligibility','analysis'}
ALLOWED_EDGES = {'SUPPORTS','MEASURED_BY','SCHEDULED_AT','ANALYZED_BY','REQUIRES_AT'}

def build_graph(payload: dict) -> nx.DiGraph:
    graph = nx.DiGraph()
    for node in payload.get('nodes', []):
        if node['type'] not in ALLOWED_TYPES:
            raise ValueError(f"Unknown node type: {node['type']}")
        attrs = {k: v for k, v in node.items() if k != 'id'}
        graph.add_node(node['id'], **attrs)
    for edge in payload.get('edges', []):
        if edge['type'] not in ALLOWED_EDGES:
            raise ValueError(f"Unknown edge type: {edge['type']}")
        if edge['source'] not in graph or edge['target'] not in graph:
            raise ValueError(f"Edge references missing node: {edge}")
        graph.add_edge(edge['source'], edge['target'], type=edge['type'])
    return graph

def graph_json(graph: nx.DiGraph) -> dict:
    return {
        'nodes': [{'id': n, **dict(d)} for n, d in graph.nodes(data=True)],
        'edges': [{'source': u, 'target': v, **dict(d)} for u, v, d in graph.edges(data=True)]
    }
/**
 * The demo's sample drawings: an Excalidraw sketch of the checkout flow and a
 * draw.io architecture diagram.
 */

let seed = 1000;

function base(id: string, type: string, x: number, y: number, width: number, height: number) {
  seed += 7;
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null as { type: number } | null,
    seed,
    version: 1,
    versionNonce: seed * 3,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false
  };
}

function box(id: string, x: number, y: number, label: string, color: string) {
  return [
    {
      ...base(id, 'rectangle', x, y, 200, 80),
      backgroundColor: color,
      roundness: { type: 3 }
    },
    {
      ...base(`${id}-label`, 'text', x + 16, y + 28, 168, 25),
      text: label,
      originalText: label,
      fontSize: 20,
      fontFamily: 5,
      textAlign: 'center',
      verticalAlign: 'middle',
      containerId: null,
      lineHeight: 1.25,
      autoResize: false
    }
  ];
}

function arrow(id: string, x: number, y: number, dx: number, dy: number) {
  return {
    ...base(id, 'arrow', x, y, Math.abs(dx), Math.abs(dy)),
    roundness: { type: 2 },
    points: [
      [0, 0],
      [dx, dy]
    ],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: 'arrow',
    elbowed: false
  };
}

/** Checkout with a saved card, sketched as a flow. */
export function checkoutSketch() {
  return {
    elements: [
      ...box('cart', 0, 0, 'Cart', '#ffec99'),
      arrow('a1', 210, 40, 120, 0),
      ...box('pick-card', 340, 0, 'Pick saved card', '#a5d8ff'),
      arrow('a2', 550, 40, 120, 0),
      ...box('charge', 680, 0, 'Charge card', '#b2f2bb'),
      arrow('a3', 780, 90, 0, 110),
      ...box('confirm', 680, 210, 'Order confirmed', '#b2f2bb'),
      arrow('a4', 670, 250, -120, 0),
      ...box('email', 340, 210, 'Send receipt', '#d0bfff'),
      {
        ...base('note', 'text', 0, 140, 300, 50),
        text: '3-D Secure? → ask the bank,\nthen retry the charge',
        originalText: '3-D Secure? → ask the bank,\nthen retry the charge',
        fontSize: 16,
        fontFamily: 5,
        textAlign: 'left',
        verticalAlign: 'top',
        containerId: null,
        lineHeight: 1.25,
        autoResize: true,
        strokeColor: '#e03131'
      }
    ],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {}
  };
}

function cell(id: string, value: string, x: number, y: number, style: string, w = 160, h = 60) {
  return `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
}

function edge(id: string, source: string, target: string, label = '') {
  return `<mxCell id="${id}" value="${label}" style="endArrow=classic;html=1;rounded=1;" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
}

/** Production architecture, as a draw.io diagram. */
export function architectureDiagram(): string {
  const service = 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;';
  const data = 'shape=cylinder3;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;';
  const external =
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;dashed=1;';
  const cells = [
    cell(
      'users',
      'Customers',
      0,
      140,
      'ellipse;whiteSpace=wrap;html=1;fillColor=#f5f5f5;',
      120,
      60
    ),
    cell('cdn', 'CDN', 180, 140, service, 120, 60),
    cell('web', 'Web app (Next.js)', 360, 140, service),
    cell('worker', 'Worker', 360, 300, service),
    cell('db', 'PostgreSQL', 600, 60, data, 120, 80),
    cell('redis', 'Redis', 600, 220, data, 120, 80),
    cell('stripe', 'Stripe', 600, 380, external, 120, 60),
    edge('e1', 'users', 'cdn', 'HTTPS'),
    edge('e2', 'cdn', 'web'),
    edge('e3', 'web', 'db', 'SQL'),
    edge('e4', 'web', 'redis', 'cache'),
    edge('e5', 'web', 'worker', 'jobs'),
    edge('e6', 'worker', 'stripe', 'charges')
  ];
  return `<mxfile host="DevOne"><diagram id="architecture" name="Architecture"><mxGraphModel dx="1000" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1100" pageHeight="850"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel></diagram></mxfile>`;
}

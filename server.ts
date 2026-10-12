import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/api/live' });

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Curated fallback observatory registry with authentic Google Maps locations
const fallbackObservatories: Record<string, {
  title: string;
  location: string;
  description: string;
  query: string;
}> = {
  kennedy: {
    title: "NASA Kennedy Space Center",
    location: "Merritt Island, Florida 32899, USA",
    description: "America's premier spaceport, launching interplanetary spacecraft to Mars, Venus, and deep space exploration programs.",
    query: "NASA+Kennedy+Space+Center+Florida"
  },
  alma: {
    title: "ALMA Observatory (Atacama Large Millimeter/submillimeter Array)",
    location: "Chajnantor Plateau, San Pedro de Atacama, Chile",
    description: "The world's most powerful radio observatory (at 5,000m altitude), investigating protoplanetary disks, stellar chemistry, and planetary atmospheres.",
    query: "ALMA+Observatory+Chile"
  },
  maunakea: {
    title: "Mauna Kea Observatories",
    location: "Mauna Kea, Hilo, Hawaii 96720, USA",
    description: "World-leading optical and infrared observatory complex (4,205m summit), hosting Keck I & II, Subaru, and Gemini North telescopes.",
    query: "Mauna+Kea+Observatories+Hawaii"
  },
  kourou: {
    title: "Guiana Space Centre (Europe's Spaceport)",
    location: "Kourou, French Guiana",
    description: "Equatorial rocket launch complex managed by ESA and CNES, launching major planetary science missions like BepiColombo and Juice.",
    query: "Guiana+Space+Centre+Kourou"
  },
  vla: {
    title: "Karl G. Jansky Very Large Array (VLA)",
    location: "San Agustin Plains, Socorro County, New Mexico, USA",
    description: "Centimeter-wavelength radio astronomy observatory consisting of 27 movable 25-meter radio antennas studying planetary radar reflections.",
    query: "Very+Large+Array+New+Mexico"
  },
  griffith: {
    title: "Griffith Observatory",
    location: "2800 E Observatory Rd, Los Angeles, CA 90027, USA",
    description: "Iconic public observatory and planetarium with historic Zeiss refracting telescopes studying solar system bodies since 1935.",
    query: "Griffith+Observatory+Los+Angeles"
  }
};

function getFallbackGrounding(queryStr: string) {
  const q = (queryStr || '').toLowerCase();
  const selectedKeys = Object.keys(fallbackObservatories).filter(k => 
    q.includes(k) || fallbackObservatories[k].title.toLowerCase().includes(q)
  );

  const keys = selectedKeys.length > 0 ? selectedKeys : Object.keys(fallbackObservatories);

  const textLines = [
    "### Grounded Earth Space Observatories & Launch Facilities\n",
    "Earth-based observatories and launch complexes are essential hubs for planetary exploration and space research:\n"
  ];

  const chunks = keys.map((k, idx) => {
    const item = fallbackObservatories[k];
    textLines.push(
      `${idx + 1}. **${item.title}** (${item.location})\n` +
      `   *Role:* ${item.description}\n`
    );
    return {
      maps: {
        title: `${item.title} — ${item.location}`,
        uri: `https://www.google.com/maps/search/?api=1&query=${item.query}`
      }
    };
  });

  return {
    text: textLines.join('\n'),
    groundingMetadata: {
      groundingChunks: chunks
    },
    isFallback: true,
  };
}

// 1. Google Maps Grounding via gemini-3.5-flash with resilient quota recovery
app.post('/api/maps-grounding', async (req, res) => {
  const { query, planet } = req.body;
  const prompt = query || `Identify key Earth-based astronomical observatories, space centers, or launch facilities associated with studying ${planet || 'planetary science'}. Include their locations and significance.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        tools: [{ googleMaps: {} }],
        systemInstruction:
          'You are a space science guide for SpaceEdu. Provide accurate, grounded information about Earth observatories, NASA/ESA space centers, planetariums, and space facilities with their real-world locations.',
      },
    });

    res.json({
      text: response.text,
      groundingMetadata: response.candidates?.[0]?.groundingMetadata,
      isFallback: false,
    });
  } catch (err: any) {
    const isRateLimit = err?.message?.includes('429') ||
      err?.message?.includes('quota') ||
      err?.message?.includes('RESOURCE_EXHAUSTED') ||
      err?.status === 'RESOURCE_EXHAUSTED';

    if (isRateLimit) {
      console.warn('Maps grounding rate limit (429) hit; serving verified astronomical registry data with Google Maps coordinates.');
      const fallback = getFallbackGrounding(query || '');
      res.json({
        ...fallback,
        notice: 'Gemini live quota is currently busy; displayed verified planetary observatory locations with direct Google Maps search integration.',
      });
      return;
    }

    console.warn('Maps grounding query error, falling back to verified database:', err?.message || err);
    const fallback = getFallbackGrounding(query || '');
    res.json(fallback);
  }
});

// 2. Science Skills: Astrobiology & Planetary Chemistry Data
app.get('/api/science/:planet', async (req, res) => {
  try {
    const planet = (req.params.planet || 'earth').toLowerCase();

    // Planetary molecules mapping for PubChem
    const planetMolecules: Record<string, Array<{ name: string; formula: string; role: string; cid: number }>> = {
      earth: [
        { name: 'Water', formula: 'H2O', role: 'Universal solvent supporting planetary life', cid: 962 },
        { name: 'Molecular Oxygen', formula: 'O2', role: 'Photosynthetic biomarker in atmosphere', cid: 977 },
        { name: 'Nitrogen', formula: 'N2', role: 'Primary atmospheric buffer gas (78%)', cid: 947 },
        { name: 'Carbon Dioxide', formula: 'CO2', role: 'Carbon cycle & greenhouse regulator', cid: 280 }
      ],
      venus: [
        { name: 'Sulfuric Acid', formula: 'H2SO4', role: 'Dense cloud decks at 48-65 km altitude', cid: 1118 },
        { name: 'Carbon Dioxide', formula: 'CO2', role: 'Supercritical atmosphere component (96.5%)', cid: 280 },
        { name: 'Sulfur Dioxide', formula: 'SO2', role: 'Volcanic and photochemical haze driver', cid: 1119 },
        { name: 'Carbon Monoxide', formula: 'CO', role: 'Photodissociation product in upper mesosphere', cid: 281 }
      ],
      mars: [
        { name: 'Iron(III) Oxide', formula: 'Fe2O3', role: 'Hematite pigment giving Martian rust-red color', cid: 518696 },
        { name: 'Carbon Dioxide', formula: 'CO2', role: 'Thin atmosphere (95%) and seasonal polar dry ice', cid: 280 },
        { name: 'Perchlorate', formula: 'ClO4-', role: 'Toxic Martian regolith salt with water eutectic properties', cid: 24716 },
        { name: 'Methane', formula: 'CH4', role: 'Trace seasonal release candidate biomarker', cid: 297 }
      ]
    };

    // Extremophile space biology data (UniProt / AlphaFold)
    const spaceOrganisms: Record<string, Array<{ name: string; organism: string; description: string; uniprot: string; source: string }>> = {
      earth: [
        { name: 'Rubisco Large Subunit', organism: 'Spinacia oleracea', description: 'Primary carbon fixation enzyme driving planetary biosphere', uniprot: 'P00875', source: 'UniProtKB / PDB' },
        { name: 'Damage Suppressor (Dsup)', organism: 'Ramazzottius varieornatus (Tardigrade)', description: 'Chromatin-binding protein shielding DNA against cosmic radiation', uniprot: 'P0DOW2', source: 'AlphaFold DB' }
      ],
      venus: [
        { name: 'Acid Stable Chaperone HdeA', organism: 'Acidophilic bacterium', description: 'Survives extreme acidic pH 1-3 conditions analogous to Venus cloud droplets', uniprot: 'P0AED9', source: 'UniProtKB' },
        { name: 'Sulfur Oxygenase Reductase', organism: 'Acidianus ambivalens', description: 'Thermophilic sulfur oxidation pathway in extreme geothermal environments', uniprot: 'Q9HH22', source: 'RCSB PDB' }
      ],
      mars: [
        { name: 'DNA Repair Recombinase RecA', organism: 'Deinococcus radiodurans', description: 'Super-efficient double-strand break repair surviving Mars-level UV and desiccation', uniprot: 'P43705', source: 'AlphaFold DB' },
        { name: 'Superoxide Dismutase (SOD)', organism: 'Deinococcus radiodurans', description: 'Shields against intense reactive oxygen species from Martian perchlorates', uniprot: 'Q9RXR7', source: 'UniProtKB' }
      ]
    };

    const molecules = planetMolecules[planet] || planetMolecules.earth;
    const biology = spaceOrganisms[planet] || spaceOrganisms.earth;

    res.json({
      planet,
      molecules,
      biology,
    });
  } catch (err: any) {
    console.error('Science API error:', err);
    res.status(500).json({ error: err.message || 'Science query failed' });
  }
});

// 3. Live Audio/Voice Session WebSocket (gemini-3.8-live)
wss.on('connection', async (clientWs: WebSocket) => {
  let session: any = null;

  try {
    session = await ai.live.connect({
      model: 'gemini-3.8-live',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
        },
        systemInstruction:
          'You are the expert astrophysicist and planetary voice guide for SpaceEdu. Speak clearly, concisely, and engagingly about Earth, Venus, Mars, space exploration, and celestial science.',
      },
      callbacks: {
        onmessage: (message: LiveServerMessage) => {
          if (clientWs.readyState !== WebSocket.OPEN) return;
          const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          const text = message.serverContent?.modelTurn?.parts?.[0]?.text;
          if (audio) {
            clientWs.send(JSON.stringify({ audio }));
          }
          if (text) {
            clientWs.send(JSON.stringify({ text }));
          }
          if (message.serverContent?.interrupted) {
            clientWs.send(JSON.stringify({ interrupted: true }));
          }
        },
        onclose: () => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ closed: true }));
          }
        },
      },
    });

    clientWs.on('message', (data: any) => {
      try {
        const payload = JSON.parse(data.toString());
        if (payload.audio && session) {
          session.sendRealtimeInput({
            audio: { data: payload.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (payload.text && session) {
          session.sendRealtimeInput({
            text: payload.text,
          });
        }
      } catch (e) {
        console.error('Error handling client live message:', e);
      }
    });

    clientWs.on('close', () => {
      // Disconnect cleanly
    });
  } catch (err: any) {
    const isRateLimit = err?.message?.includes('429') ||
      err?.message?.includes('quota') ||
      err?.message?.includes('RESOURCE_EXHAUSTED');

    if (isRateLimit) {
      console.warn('Live API rate limit reached (429).');
    } else {
      console.warn('Live connect warning:', err?.message || err);
    }

    if (clientWs.readyState === WebSocket.OPEN) {
      const msg = isRateLimit
        ? 'Live API session quota is temporarily rate-limited. You can test prompts with the planetary questions, or explore the Science Lab and Maps Grounding.'
        : (err?.message || 'Failed to connect to Live API');
      clientWs.send(JSON.stringify({ error: msg }));
    }
  }
});

// 4. Vite middleware integration for Full-Stack
async function startServer() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  const PORT = 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`SpaceEdu server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();

window.ARIKARA = {
  genres: [
    "Trap",
    "Rap",
    "Flamenco",
    "Rap Flamenco",
    "Flamenco Reggaeton",
    "Flamenco Experimental",
    "Flamenco Drill",
    "Afrobeat",
    "Flamenco Afrobeat"
  ],
  beats: [
    {
      id: "ab-001",
      slug: "costa-del-sol",
      title: "Delaossa Type Beat - \"Costa Del Sol\"",
      bpm: 88,
      key: "F minor",
      genre: "Rap Flamenco",
      tags: ["typebeat", "delaossa", "flamenco", "rap", "instrumental", "beat andaluz"],
      moods: ["cálido", "melódico"],
      cover: "./assets/covers/costa-del-sol.jpg",
      preview: "./assets/audio/costa-del-sol-preview.mp3",
      prices: { basic: 29.99, premium: 79.99, exclusive: 299.99 },
      status: "available",
      createdAt: "2026-02-03"
    },
    {
      id: "ab-002",
      slug: "luna-mora",
      title: "Maka Type Beat - \"Luna Mora\"",
      bpm: 91,
      key: "G minor",
      genre: "Flamenco Reggaeton",
      tags: ["typebeat", "maka", "flamenco", "reggaeton", "instrumental"],
      moods: ["nocturno", "melódico"],
      cover: "./assets/covers/luna-mora.jpg",
      preview: "./assets/audio/luna-mora-preview.mp3",
      prices: { basic: 29.99, premium: 79.99, exclusive: 299.99 },
      status: "available",
      createdAt: "2026-02-06"
    },
    {
      id: "ab-003",
      slug: "feria-y-oro",
      title: "Dellafuente Type Beat - \"Feria y Oro\"",
      bpm: 73,
      key: "G minor",
      genre: "Flamenco Experimental",
      tags: ["typebeat", "dellafuente", "flamenco", "experimental", "instrumental"],
      moods: ["nostalgico", "etereo"],
      cover: "./assets/covers/feria-y-oro.jpg",
      preview: "./assets/audio/feria-y-oro-preview.mp3",
      prices: { basic: 29.99, premium: 79.99, exclusive: 299.99 },
      status: "available",
      createdAt: "2026-02-10"
    },
    {
      id: "ab-004",
      slug: "la-calle-mi-casa",
      title: "Central Cee x Morad Type Beat - \"La Calle Mi Casa\"",
      bpm: 72,
      key: "C minor",
      genre: "Flamenco Drill",
      tags: ["typebeat", "central cee", "morad", "flamenco", "drill", "instrumental"],
      moods: ["oscuro", "tenso"],
      cover: "./assets/covers/la-calle-mi-casa.jpg",
      preview: "./assets/audio/la-calle-mi-casa-preview.mp3",
      prices: { basic: 29.99, premium: 79.99, exclusive: 299.99 },
      status: "available",
      createdAt: "2026-02-11"
    }
  ],
  licenses: [
    {
      id: "basic",
      name: "Basic",
      price: 29.99,
      priceLabel: "29,99 EUR",
      includes: ["MP3", "WAV", "Uso comercial", "Hasta 100K streams"],
      highlight: false
    },
    {
      id: "premium",
      name: "Premium",
      price: 79.99,
      priceLabel: "79,99 EUR",
      includes: ["MP3", "WAV", "STEMS", "Uso comercial", "Hasta 500K streams"],
      highlight: true
    },
    {
      id: "exclusive",
      name: "Exclusive",
      price: 299.99,
      priceLabel: "Desde 299,99 EUR",
      includes: ["MP3", "WAV", "STEMS", "Uso comercial", "Streams ilimitados", "Full rights"],
      highlight: false,
      disabled: true
    }
  ],
  services: [
    {
      id: "basic",
      name: "Basic",
      priceLabel: "79,99 EUR / canción",
      includes: ["Mixing", "Mastering", "Por stems/pistas"],
      highlight: false
    },
    {
      id: "premium",
      name: "Premium",
      priceLabel: "129,99 EUR / canción",
      includes: ["Mixing", "Mastering", "Por stems/pistas", "Arreglos", "Producción"],
      highlight: false
    },
    {
      id: "pro",
      name: "Pro",
      priceLabel: "199,99 EUR / canción",
      includes: ["Mixing", "Mastering", "Por stems/pistas", "Arreglos", "Producción", "Tratamiento vocal"],
      highlight: true
    }
  ]
};

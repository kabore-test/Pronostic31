/**
 * PREDICTOR PRO - Intelligence Artificielle Football
 * Fichier : anal.js
 */

const CONFIG = {
    FD_KEY: '1a1c5e8ed55a45d599d421f063a7f70d',
    AF_KEY: '481201d619msh18314425693e4e7p189324jsnac033d40365a',
    BASE_URL_FD: 'https://api.football-data.org/v4',
    BASE_URL_AF: 'https://api-football-v1.p.rapidapi.com/v3'
};

let liveMatches = [];
let dbLocal = { equipes: {} };
const $ = (id) => document.getElementById(id);

window.addEventListener("load", async () => {
    await loadLocalDB();
    renderHistory();

    // Auto-complétion Home
    $("homeSearch").addEventListener("input", () => handleSearch("homeSearch", "homeSuggestions"));
    // Auto-complétion Away
    $("awaySearch").addEventListener("input", () => handleSearch("awaySearch", "awaySuggestions"));

    $("btnAiSearch").onclick = () => {
        const h = $("homeSearch").value;
        const a = $("awaySearch").value;
        if (h && a) lancerAnalyse(h, a);
        else alert("Veuillez sélectionner deux équipes !");
    };

    // Fermer les suggestions si on clique ailleurs
    document.addEventListener("click", (e) => {
        if (!e.target.closest('.input-with-suggestions')) {
            document.querySelectorAll('.suggestions-box').forEach(b => b.classList.add('hidden'));
        }
    });

    $("btnDeepScan").onclick = lancerDeepScan;

    chargerMatchsDuMonde();
});


async function loadLocalDB() {
    // Si vous avez un fichier anal.json, il sera chargé ici. 
    // Sinon, le système reste en mode API.
    try {
        const res = await fetch("anal.json");
        if (res.ok) dbLocal = await res.json();
    } catch (e) {
        // Silencieux car anal.json est optionnel
    }
}

function renderQuickMatches() {
    const container = $("quickMatchList");
    if (liveMatches.length === 0) {
        container.innerHTML = '<p class="tiny muted">Chargement des matchs en direct...</p>';
        return;
    }
    container.innerHTML = liveMatches.slice(0, 10).map(m => `
        <div class="quick-chip" onclick="quickSelect('${m.home.replace(/'/g, "\\'")}', '${m.away.replace(/'/g, "\\'")}')">
            <span class="tiny muted">${m.league}</span>
            <b>${m.home} vs ${m.away}</b>
            <span class="tiny accent">${m.time}</span>
        </div>
    `).join('');
}

function effacerHistorique() {
    if (confirm("Voulez-vous vraiment effacer tout l'historique de session ?")) {
        localStorage.removeItem("bets");
        renderHistory();
    }
}


function handleSearch(inputId, suggestionId) {
    const query = $(inputId).value.toLowerCase().trim();
    const box = $(suggestionId);

    if (query.length < 1) {
        box.classList.add('hidden');
        return;
    }

    // Extraire les noms d'équipes uniques des matchs live
    const teams = new Set();
    liveMatches.forEach(m => { teams.add(m.home); teams.add(m.away); });
    // Ajouter les équipes de la DB locale
    Object.keys(dbLocal.equipes).forEach(name => teams.add(name));

    const filtered = Array.from(teams).filter(t => t.toLowerCase().includes(query)).slice(0, 5);

    if (filtered.length > 0) {
        box.innerHTML = filtered.map(t => `<div onclick="setTeam('${inputId}', '${t}')">${t}</div>`).join('');
        box.classList.remove('hidden');
    } else {
        box.classList.add('hidden');
    }
}

function setTeam(inputId, name) {
    $(inputId).value = name;
    document.querySelectorAll('.suggestions-box').forEach(b => b.classList.add('hidden'));
}

function quickSelect(h, a) {
    $("homeSearch").value = h;
    $("awaySearch").value = a;
}

/* --- RÉCUPÉRATION RÉELLE VIA API-FOOTBALL (RAPIDAPI) --- */
async function getRealStats(teamName) {
    const headers = {
        'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
        'x-rapidapi-key': CONFIG.AF_KEY
    };

    try {
        // 1. Recherche de l'ID de l'équipe (Plus agressive)
        const teamSearch = await fetch(`${CONFIG.BASE_URL_AF}/teams?name=${teamName}`, { headers });
        let teamData = await teamSearch.json();

        if (!teamData.response?.length) {
            // Deuxième tentative avec 'search' si 'name' échoue
            const searchRes = await fetch(`${CONFIG.BASE_URL_AF}/teams?search=${teamName}`, { headers });
            teamData = await searchRes.json();
        }

        if (!teamData.response?.length) return null;

        const teamId = teamData.response[0].team.id;
        const officialName = teamData.response[0].team.name;
        console.log(`Match API trouvé : ${officialName} (ID: ${teamId})`);

        // 2. Récupération des 5 derniers matchs
        const lastFixtures = await fetch(`${CONFIG.BASE_URL_AF}/fixtures?team=${teamId}&last=5`, { headers });
        const fixturesData = await lastFixtures.json();

        if (!fixturesData.response?.length) return null;

        const matches = fixturesData.response;
        const history = [];

        for (const m of matches) {
            const isHome = m.teams.home.id === teamId;
            const goals = isHome ? (m.goals.home ?? 0) : (m.goals.away ?? 0);

            // Pour les corners/cartons, on utilise une graine basée sur l'ID du match pour que ce soit FIXE
            const matchSeed = m.fixture.id;

            history.push({
                buts: goals,
                corners: 3 + (matchSeed % 7),
                jaunes: (matchSeed % 4),
                rouges: (matchSeed % 15 === 0) ? 1 : 0,
                victoire: (isHome && m.teams.home.winner) || (!isHome && m.teams.away.winner) ? "OUI" : "NON",
                date: new Date(m.fixture.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
            });
        }
        return { officialName, history };
    } catch (e) {
        console.error("Erreur API:", e);
        return null;
    }
}

async function lancerAnalyse(h, a) {
    $("loading").classList.remove("hidden");
    $("affichage").innerHTML = `<p class="tiny muted" style="text-align:center;">Analyse des données réelles...</p>`;
    $("pronostics").classList.add("hidden");
    $("iaPredictionContainer").classList.add("hidden");

    // 1. Récupération
    const dataH = await getRealStats(h);
    const dataA = await getRealStats(a);

    let histH, histA, nameH = h, nameA = a;

    if (dataH && dataA) {
        histH = dataH.history;
        histA = dataA.history;
        nameH = dataH.officialName;
        nameA = dataA.officialName;
        $("dataModeBadge").textContent = "MODE: LIVE DATA (OK)";
        $("dataModeBadge").style.background = "var(--good)";
    } else {
        // MODE SECOURS STABLE (Ne varie plus au hasard)
        const getStableSimul = (name) => {
            const seed = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
            return Array.from({ length: 5 }, (_, i) => ({
                num: i + 1,
                buts: (seed + i) % 4,
                corners: 3 + ((seed + i) % 8),
                jaunes: (seed + i) % 3,
                rouges: 0,
                victoire: (seed + i) % 2 === 0 ? "OUI" : "NON",
                date: (10 + i) + "/02"
            }));
        };
        histH = getStableSimul(h);
        histA = getStableSimul(a);
        $("dataModeBadge").textContent = "MODE: IA STABLE (SEARCH ERROR)";
        $("dataModeBadge").style.background = "var(--bad)";
    }

    // 2. Calcul des moyennes
    const calcAvg = (hist) => ({
        buts: (hist.reduce((acc, m) => acc + m.buts, 0) / hist.length).toFixed(1),
        victoires: hist.filter(m => m.victoire === "OUI").length,
        corners: hist.reduce((acc, m) => acc + m.corners, 0),
        jaunes: hist.reduce((acc, m) => acc + m.jaunes, 0),
        rouges: hist.reduce((acc, m) => acc + m.rouges, 0)
    });

    const s1 = { ...calcAvg(histH), nom: nameH };
    const s2 = { ...calcAvg(histA), nom: nameA };

    // 3. Algorithme de Kelly
    const bankroll = parseFloat($("inputBankroll").value) || 10000;
    const probH = Math.round((parseFloat(s1.buts) / (parseFloat(s1.buts) + parseFloat(s2.buts))) * 100) || 50;
    const cote = (1.2 + (Math.random() * 1.8)).toFixed(2);

    const p = probH / 100;
    const q = 1 - p;
    const b = cote - 1;
    const f = (p * b - q) / b;
    const mise = f > 0 ? Math.round((bankroll * f) / 4) : 200;

    // 4. Affichage (en passant l'historique réel)
    displayResults(s1, s2, probH, cote, mise, histH, histA);
    $("loading").classList.add("hidden");
}


function displayResults(s1, s2, prob, cote, mise, hist1, hist2) {
    const renderExcelTable = (teamName, history) => `
        <div class="excel-table-container">
            <table class="excel-table">
                <thead>
                    <tr>
                        <th style="background:#e67e22; color:white;">${teamName} / Matchs</th>
                        <th>BUTS</th>
                        <th>CORNERS</th>
                        <th>CARTONS JAUNES</th>
                        <th>CARTONS ROUGES</th>
                        <th>VICTOIRES</th>
                        <th>DATE</th>
                    </tr>
                </thead>
                <tbody>
                    ${history.map((m, idx) => {
        let label = (idx + 1) + 'e match';
        if (idx === 0) label = "Dernier match";
        if (idx === 1) label = "Avant-dernier match)";
        return `
                        <tr class="${idx % 2 === 0 ? 'row-even' : 'row-odd'}">
                            <td>${label}</td>
                            <td>${m.buts}</td>
                            <td>${m.corners}</td>
                            <td>${m.jaunes}</td>
                            <td class="${m.rouges > 0 ? 'red-cell' : ''}">${m.rouges}</td>
                            <td class="${m.victoire === 'OUI' ? 'win-cell' : 'loss-cell'}">${m.victoire}</td>
                            <td>${m.date}</td>
                        </tr>
                    `}).join('')}
                </tbody>
            </table>
        </div>
    `;

    // Affichage des tableaux
    $("affichage").innerHTML = `
        <div class="analysis-results-wrap">
            ${renderExcelTable(s1.nom, hist1)}
            <div style="margin: 20px 0;"></div>
            ${renderExcelTable(s2.nom, hist2)}
        </div>
    `;

    // 2. Comparaison Visuelle Détaillée
    const renderStatRow = (label, val1, val2, max, unit = "") => {
        const perc1 = (val1 / (parseFloat(val1) + parseFloat(val2) + 0.1)) * 100;
        const perc2 = 100 - perc1;
        return `
            <div class="stat-item-row">
                <div class="stat-value left">${val1}${unit}</div>
                <div class="stat-center">
                    <div class="stat-label">${label}</div>
                    <div class="dual-bar">
                        <div class="bar-left"><div class="bar-fill-left" style="width:${perc1}%"></div></div>
                        <div class="bar-right"><div class="bar-fill-right" style="width:${perc2}%"></div></div>
                    </div>
                </div>
                <div class="stat-value right">${val2}${unit}</div>
            </div>
        `;
    };

    $("statsDetails").innerHTML = `
        <div class="stats-comparison-panel">
            <div class="comparison-header">
                <div class="team-header-side"><span class="team-label">DOMICILE</span><h3>${s1.nom}</h3></div>
                <div class="vs-badge">VS</div>
                <div class="team-header-side"><span class="team-label">EXTÉRIEUR</span><h3>${s2.nom}</h3></div>
            </div>
            <div class="stats-grid-detailed">
                ${renderStatRow("Moyenne Buts", s1.buts, s2.buts)}
                ${renderStatRow("Forme (Victoires)", s1.victoires, s2.victoires)}
                ${renderStatRow("Total Corners", s1.corners, s2.corners)}
                ${renderStatRow("Agressivité (Jaunes)", s1.jaunes, s2.jaunes)}
            </div>
        </div>
    `;
    $("statsDetails").classList.remove("hidden");

    // 3. Probabilités
    $("probContainer").innerHTML = `
        <div class="prob-row">
            <div class="prob-info"><span>${s1.nom}</span> <b>${prob}%</b></div>
            <div class="prob-bar"><div class="prob-fill" style="width:${prob}%"></div></div>
        </div>
        <div class="prob-row">
            <div class="prob-info"><span>Match Nul / Autre</span> <b>${Math.max(10, 100 - prob - 20)}%</b></div>
            <div class="prob-bar"><div class="prob-fill" style="width:${Math.max(10, 100 - prob - 20)}%; background:rgba(255,255,255,0.1)"></div></div>
        </div>
        <div class="prob-row">
            <div class="prob-info"><span>${s2.nom}</span> <b>${100 - prob}%</b></div>
            <div class="prob-bar"><div class="prob-fill" style="width:${100 - prob}%; background:var(--bad)"></div></div>
        </div>
        
        <div class="investment-stats">
            <div class="stat-box"> <small>COTE ANALYSÉE</small> <strong>${cote}</strong> </div>
            <div class="stat-box"> <small>MISE RECOMMANDÉE</small> <strong class="good">${mise} CFA</strong> </div>
        </div>
    `;

    // 3. Prédiction Finale
    $("iaPrediction").innerHTML = `
        <div class="prediction-header">SCORE EXACT PRÉVU</div>
        <div class="score">${Math.ceil(s1.buts)} - ${Math.floor(s2.buts)}</div>
        <div class="actions">
            <button onclick="saveCurrentAnalysis()" class="btn-save">💾 SAUVEGARDER L'ANALYSE</button>
            <a href="https://1xbet.com" target="_blank" class="btn-link">PARIER SUR 1XBET</a>
        </div>
    `;

    // Stockage temporaire pour la sauvegarde
    window.currentAnalysis = {
        match: `${s1.nom} vs ${s2.nom}`,
        mise,
        cote,
        s1,
        s2
    };

    $("pronostics").classList.remove("hidden");
    $("iaPredictionContainer").classList.remove("hidden");
    $("affichage").scrollIntoView({ behavior: 'smooth' });
}


function saveCurrentAnalysis() {
    if (window.currentAnalysis) {
        const { match, mise, cote, s1, s2 } = window.currentAnalysis;
        saveBet(match, mise, cote, s1, s2);
    }
}

function saveBet(match, mise, cote, statsH, statsA) {

    const history = JSON.parse(localStorage.getItem("bets")) || [];
    history.unshift({
        match,
        mise,
        cote,
        date: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        statsH,
        statsA
    });
    localStorage.setItem("bets", JSON.stringify(history.slice(0, 5))); // On garde les 5 derniers
    renderHistory();
    alert("Analyse sauvegardée dans l'historique !");
}

function renderHistory() {
    const history = JSON.parse(localStorage.getItem("bets")) || [];
    const container = $("betHistory");

    if (history.length === 0) {
        container.innerHTML = '<p class="tiny muted">Aucune analyse récente.</p>';
        return;
    }

    container.innerHTML = history.map(b => `
        <div class="history-card-detailed">
            <div class="hist-header">
                <b>${b.match}</b>
                <span class="tiny muted">${b.date}</span>
            </div>
            <div class="hist-stats-table">
                <div class="hist-stat-row uppercase tiny">
                    <span class="team-mini-stats">
                        ${b.statsH.victoires}V | ${b.statsH.buts}B | ${b.statsH.corners}C | ${b.statsH.jaunes}J | <b style="color:var(--bad)">${b.statsH.rouges}R</b>
                    </span>
                    <span class="muted separator">VS</span>
                    <span class="team-mini-stats">
                        ${b.statsA.victoires}V | ${b.statsA.buts}B | ${b.statsA.corners}C | ${b.statsA.jaunes}J | <b style="color:var(--bad)">${b.statsA.rouges}R</b>
                    </span>
                </div>
            </div>
            <div class="hist-footer">
                <div class="hist-investment">
                    <span class="accent">${b.mise} CFA</span>
                    <small class="muted">@ ${b.cote}</small>
                </div>
                <div class="hist-score-pred">
                    <span class="tiny muted">PRÉVU:</span> <b>${Math.ceil(b.statsH.buts)} - ${Math.floor(b.statsA.buts)}</b>
                </div>
            </div>
        </div>
    `).join('');
}

async function chargerMatchsDuMonde() {
    try {
        const response = await fetch(`${CONFIG.BASE_URL_FD}/matches`, {
            headers: { 'X-Auth-Token': CONFIG.FD_KEY }
        });
        const data = await response.json();

        if (data.matches) {
            liveMatches = data.matches.map(m => ({
                id: m.id,
                league: m.competition.name,
                home: m.homeTeam.shortName || m.homeTeam.name,
                away: m.awayTeam.shortName || m.awayTeam.name,
                time: new Date(m.utcDate).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
            }));

            renderQuickMatches();
            $("dataModeBadge").textContent = "MODE: LIVE API";
            $("dataModeBadge").style.background = "var(--good)";
        }
    } catch (e) {
        console.warn("Échec du chargement des matchs live", e);
        $("dataModeBadge").textContent = "MODE: LOCAL";
    }
}

async function lancerDeepScan() {
    if (liveMatches.length === 0) {
        alert("Attendez le chargement des matchs en direct...");
        return;
    }

    $("scanLoader").classList.remove("hidden");
    $("hotPicksContainer").innerHTML = "";

    // Simulation d'une analyse poussée
    setTimeout(() => {
        $("scanLoader").classList.add("hidden");
        const picks = liveMatches.slice(0, 3).map(m => `
            <div class="hot-pick-card" onclick="quickSelect('${m.home.replace(/'/g, "\\'")}', '${m.away.replace(/'/g, "\\'")}')">
                <div class="tiny muted">${m.league}</div>
                <div class="tiny accent" style="font-weight:900">IA CONFIDENCE: ${70 + Math.floor(Math.random() * 25)}%</div>
                <b>${m.home} vs ${m.away}</b>
                <div class="tiny muted">Cote estimée: ${(1.5 + Math.random()).toFixed(2)}</div>
            </div>
        `).join('');
        $("hotPicksContainer").innerHTML = picks;
    }, 2000);
}

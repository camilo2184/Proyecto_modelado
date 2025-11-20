// --- Modelo PID e Intercambiador de Calor con Plotly.js --- //
// Autor: Versión final — integración modo manual mínima (no reescribe tu código)

// Constantes del modelo
const TAU = 30; // Constante de tiempo τ (segundos)
const K_GAIN = 100; // Ganancia estática K (°C por unidad de control)
const T_AMBIENT = 20; // Temperatura ambiente (°C)
const DT = 0.1; // Paso de tiempo para simulación (s)

// Elementos DOM (orig.)
const initialTempInput = document.getElementById('initialTemp');
const setpointInput = document.getElementById('setpoint');
const toleranceInput = document.getElementById('tolerance');
const kpInput = document.getElementById('kp');
const kiInput = document.getElementById('ki');
const kdInput = document.getElementById('kd');
const startStopBtn = document.getElementById('startStop');
const resetBtn = document.getElementById('reset');
const currentTempSpan = document.getElementById('currentTemp');
const currentErrorSpan = document.getElementById('currentError');
const settlingTimeSpan = document.getElementById('settlingTime');
const modeSpan = document.getElementById('mode');
const valveOpeningSpan = document.getElementById('valveOpening');
const simulationCanvas = document.getElementById('simulationCanvas');
const simCtx = simulationCanvas.getContext('2d');

// --- CONTROLES MANUALES (compatibilidad con checkbox o botón) ---
// HTML options supported:
// 1) <input type="checkbox" id="manualMode">  OR
// 2) <button id="toggleMode">Cambiar a Manual</button>
const manualModeCheckbox = document.getElementById('manualMode'); // optional
const toggleModeBtn = document.getElementById('toggleMode'); // optional
const manualValve = document.getElementById('manualValve'); // existing in your HTML
const manualValveValue = document.getElementById('manualValveValue'); // existing span

// Variables de estado (mantengo tus nombres y valores originales)
let isRunning = false;
let mode = 'Manual';
let currentTemp = 20;
let setpoint = 50;
let tolerance = 2;
let kp = 1;
let ki = 0.05;
let kd = 0.1;
let integral = 0;
let prevError = 0;
let time = 0;
let settlingTime = null;
let valveOpening = 0;
let steps = 0;

// NUEVO: estado manual
let manualMode = false;

// --- CONFIGURACIÓN Y PERSISTENCIA --- //
function loadConfig() {
    const saved = localStorage.getItem('pidConfig');
    if (saved) {
        const config = JSON.parse(saved);
        initialTempInput.value = config.initialTemp || 20;
        setpointInput.value = config.setpoint || 50;
        toleranceInput.value = config.tolerance || 2;
        kpInput.value = config.kp || 1;
        kiInput.value = config.ki || 0.05;
        kdInput.value = config.kd || 0.1;
        updateParams();
    } else {
        initialTempInput.value = 20;
        setpointInput.value = 50;
        toleranceInput.value = 2;
        kpInput.value = 1;
        kiInput.value = 0.05;
        kdInput.value = 0.1;
        updateParams();
    }
}

function saveConfig() {
    const config = {
        initialTemp: currentTemp,
        setpoint: setpoint,
        tolerance: tolerance,
        kp: kp,
        ki: ki,
        kd: kd
    };
    localStorage.setItem('pidConfig', JSON.stringify(config));
}

function validateInput(input, min, max) {
    let value = parseFloat(input.value);
    if (isNaN(value) || value < min || value > max) {
        alert(`Valor inválido para ${input.id}. Debe estar entre ${min} y ${max}.`);
        input.value = Math.max(min, Math.min(max, value || min));
        value = parseFloat(input.value);
    }
    return value;
}

function updateParams() {
    currentTemp = validateInput(initialTempInput, 0, 100);
    setpoint = validateInput(setpointInput, 20, 90);
    tolerance = validateInput(toleranceInput, 0.5, 5);
    kp = validateInput(kpInput, 0.1, 10);
    ki = validateInput(kiInput, 0.01, 1);
    kd = validateInput(kdInput, 0, 1);
    saveConfig();
}

// --- EVENTOS (mantengo los tuyos) --- //
startStopBtn.addEventListener('click', () => {
    isRunning = !isRunning;
    startStopBtn.textContent = isRunning ? 'Stop' : 'Start';
    // Si estamos en manual, mostrar manual; si no, mostrar segun isRunning
    mode = manualMode ? 'Manual' : (isRunning ? 'Automático' : 'Manual');
    modeSpan.textContent = mode;
    // En automático arrancar loop; en manual la simulación seguirá si manualMode==true (vease animate)
    if (isRunning && !manualMode) {
        animate();
    } else if (isRunning && manualMode) {
        // si arrancas while en manual, animate también debe correr para que la simulación avance
        animate();
    }
});

resetBtn.addEventListener('click', resetSimulation);
initialTempInput.addEventListener('change', updateParams);
setpointInput.addEventListener('change', updateParams);
toleranceInput.addEventListener('change', updateParams);
kpInput.addEventListener('change', updateParams);
kiInput.addEventListener('change', updateParams);
kdInput.addEventListener('change', updateParams);

// --- EVENTOS MODO MANUAL (SOLO LO NECESARIO) --- //
// Si existe checkbox, úsalo
if (manualModeCheckbox) {
    manualModeCheckbox.addEventListener('change', () => {
        manualMode = manualModeCheckbox.checked;
        // actualizar modo y habilitar/deshabilitar slider
        mode = manualMode ? 'Manual' : (isRunning ? 'Automático' : 'Manual');
        modeSpan.textContent = mode;
        if (manualValve) manualValve.disabled = !manualMode;
        // si entramos a manual, queremos que la simulación siga ejecutándose (aunque isRunning sea false)
        if (manualMode) {
            // animate se encarga de ejecutar mientras manualMode==true o isRunning==true
            animate();
        }
    });
}

// Si existe botón toggle, úsalo (por compatibilidad con tu HTML)
if (toggleModeBtn) {
    toggleModeBtn.addEventListener('click', () => {
        manualMode = !manualMode;
        mode = manualMode ? 'Manual' : (isRunning ? 'Automático' : 'Manual');
        modeSpan.textContent = mode;
        toggleModeBtn.textContent = manualMode ? 'Cambiar a Automático' : 'Cambiar a Manual';
        if (manualValve) manualValve.disabled = !manualMode;
        // si activamos manualMode queremos que la simulación corra para reflejar efectos del slider
        if (manualMode) animate();
    });
}

// Evento del slider manual (si existe)
if (manualValve) {
    manualValve.addEventListener('input', () => {
        // actualizar valor visible siempre
        const v = parseFloat(manualValve.value);
        if (manualValveValue) manualValveValue.textContent = v.toFixed(0);
        // si estamos en manual, actualizar apertura y visual inmediatamente
        if (manualMode) {
            valveOpening = v;
            // No alteramos integral ni prevError aquí — PID está desactivado en manual
            drawSimulation();
            updateDisplays();
        }
    });
}

// --- RESET --- //
function resetSimulation() {
    isRunning = false;
    startStopBtn.textContent = 'Start';
    mode = 'Manual';
    modeSpan.textContent = mode;
    integral = 0;
    prevError = 0;
    time = 0;
    settlingTime = null;
    valveOpening = 0;
    steps = 0;
    // reset manual slider UI if present
    if (manualValve) {
        manualValve.value = 0;
        if (manualValveValue) manualValveValue.textContent = '0';
    }
    loadConfig();
    drawSimulation();
    updateDisplays();
    initPlot(); // inicializa gráfica Plotly vacía
}

// --- ACTUALIZAR DISPLAY --- //
function updateDisplays() {
    currentTempSpan.textContent = currentTemp.toFixed(1);
    const error = ((setpoint - currentTemp) / setpoint * 100).toFixed(1);
    currentErrorSpan.textContent = error;
    settlingTimeSpan.textContent = settlingTime !== null ? settlingTime.toFixed(1) : 'N/A';
    valveOpeningSpan.textContent = valveOpening.toFixed(0);

    // Sincronizar slider/label si existen
    if (manualValve) manualValve.value = valveOpening.toFixed(0);
    if (manualValveValue) manualValveValue.textContent = valveOpening.toFixed(0);

    // Mostrar modo correcto
    mode = manualMode ? 'Manual' : (isRunning ? 'Automático' : 'Manual');
    modeSpan.textContent = mode;
}

// --- SIMULACIÓN PID --- //
function simulateStep() {
    if (manualMode) {
        // En modo manual: usar el valor de valveOpening fijado por el usuario (0-100)
        const u = valveOpening / 100;
        const dT = (- (currentTemp - T_AMBIENT) / TAU + (K_GAIN / TAU) * u) * DT;
        currentTemp += dT;

        // Avanzar tiempo y step counters como en automático
        time += DT;
        steps++;

        // No tocamos integral/prevError/settlingTime en manual (opcional: podrías querer registrar error)
        return;
    }

    // Modo automático: ejecuta tu PID exactamente como antes
    const error = setpoint - currentTemp;
    integral += error * DT;
    const derivative = (error - prevError) / DT;
    let u = kp * error + ki * integral + kd * derivative;
    u = Math.max(0, Math.min(1, u));
    valveOpening = u * 100;

    // Modelo térmico
    const dT = (- (currentTemp - T_AMBIENT) / TAU + (K_GAIN / TAU) * u) * DT;
    currentTemp += dT;

    prevError = error;
    time += DT;
    steps++;

    if (settlingTime === null && Math.abs(error / setpoint * 100) <= tolerance) {
        settlingTime = time;
    }
}

// --- COLORES --- //
function getColor(temp, setp) {
    const diff = temp - setp;
    if (diff < -10) return '#00008B';
    if (diff < -2) return '#ADD8E6';
    if (diff <= 2) return '#008000';
    if (diff <= 10) return '#FFA500';
    return '#FF0000';
}

// --- DIBUJO DE SIMULACIÓN VISUAL --- //
function drawSimulation() {
    simCtx.clearRect(0, 0, simulationCanvas.width, simulationCanvas.height);
    const tankColor = getColor(currentTemp, setpoint);
    const outletColor = tankColor; // Color dinámico para salida
    const inletColor = '#0000FF'; // Azul fijo para entrada (frío)

    // a) Tanque (intercambiador como tanque rectangular)
    simCtx.fillStyle = '#ccc';
    simCtx.fillRect(200, 200, 200, 100);
    const gradient = simCtx.createLinearGradient(200, 350, 200, 150);
    gradient.addColorStop(0, tankColor);
    gradient.addColorStop(1, lightenColor(tankColor, 0.5));
    simCtx.fillStyle = gradient;
    const height = (currentTemp / 100) * 100;
    simCtx.fillRect(200, 300 - height, 200, height);

    // b) Fluido entrada/salida
    simCtx.strokeStyle = '#000';
    simCtx.lineWidth = 2;
    simCtx.beginPath();
    simCtx.moveTo(100, 280);
    simCtx.lineTo(200, 280);
    simCtx.stroke();
    simCtx.beginPath();
    simCtx.moveTo(400, 280);
    simCtx.lineTo(520, 280);
    simCtx.stroke();

    if (isRunning || manualMode) {
        simCtx.setLineDash([5, 5]);
        simCtx.strokeStyle = inletColor;
        simCtx.beginPath();
        simCtx.moveTo(150, 280);
        simCtx.lineTo(200, 280);
        simCtx.stroke();
        simCtx.strokeStyle = outletColor;
        simCtx.beginPath();
        simCtx.moveTo(400, 280);
        simCtx.lineTo(450, 280);
        simCtx.stroke();
        simCtx.strokeStyle = tankColor;
        simCtx.beginPath();
        simCtx.moveTo(200, 280);
        simCtx.lineTo(400, 280);
        simCtx.stroke();
        simCtx.setLineDash([]);
    }

    // c) Sensor de temperatura (display digital, símbolo ISA: TE)
    simCtx.fillStyle = '#fff';
    simCtx.fillRect(470, 180, 100, 50);
    simCtx.strokeRect(470, 180, 100, 50);
    simCtx.fillStyle = '#000';
    simCtx.font = '16px Arial';
    simCtx.fillText(`${currentTemp.toFixed(1)}°C`, 480, 210);
    simCtx.beginPath();
    simCtx.arc(520, 250, 20, 0, Math.PI * 2);
    simCtx.stroke();
    simCtx.fillText('TE', 510, 255);

    // d) Controlador PID (indicador modo, error)
    simCtx.fillStyle = '#fff';
    simCtx.fillRect(600, 180, 150, 100);
    simCtx.strokeRect(600, 180, 150, 100);
    simCtx.fillStyle = '#000';
    simCtx.fillText(`Modo: ${mode}`, 610, 200);
    simCtx.fillText(`Error: ${((setpoint - currentTemp) / setpoint * 100).toFixed(1)}%`, 610, 220);
    simCtx.beginPath();
    simCtx.rect(650, 230, 40, 40);
    simCtx.moveTo(650, 230);
    simCtx.lineTo(690, 270);
    simCtx.stroke();
    simCtx.fillText('TIC', 655, 250);

    // e) Válvula de control (apertura)
    const valveState = valveOpening < 5 ? 'Cerrada' : valveOpening > 95 ? 'Abierta' : 'Parcial';
    simCtx.fillStyle = '#fff';
    simCtx.fillRect(250, 50, 120, 50);
    simCtx.strokeRect(250, 50, 120, 50);
    simCtx.fillStyle = '#000';
    simCtx.fillText(`${valveOpening.toFixed(0)}% (${valveState})`, 260, 70);
    let valveColor;
    if (valveState === 'Cerrada') valveColor = '#000000';
    else if (valveState === 'Parcial') valveColor = '#008000';
    else valveColor = '#0000FF';
    simCtx.fillStyle = valveColor;
    simCtx.beginPath();
    simCtx.moveTo(300, 120);
    simCtx.lineTo(280, 140);
    simCtx.lineTo(320, 140);
    simCtx.closePath();
    simCtx.fill();
    simCtx.stroke();
    simCtx.rect(290, 100, 20, 20);
    simCtx.stroke();

    // f) Sistema de vapor (tubería con flujo proporcional)
    simCtx.strokeStyle = '#888';

    // Tubería horizontal (entrada válvula)
    simCtx.beginPath();
    simCtx.moveTo(50, 110);
    simCtx.lineTo(290, 110);
    simCtx.stroke();

    // Tubería vertical (válvula-tanque)
    simCtx.beginPath();
    simCtx.moveTo(300, 140);
    simCtx.lineTo(300, 200);
    simCtx.stroke();

    // Animación en tubería horizontal
    const intensity = Math.floor(valveOpening / 100 * 5);
    for (let i = 1; i <= intensity; i++) {
        simCtx.beginPath();
        simCtx.moveTo(50 + i * 40, 110);
        simCtx.lineTo(50 + i * 40, 120);
        simCtx.stroke();
    }

    // Animación en tubería vertical
    const verticalSteps = 6; // Número de pasos para la animación vertical
    for (let i = 1; i <= intensity; i++) {
        simCtx.beginPath();
        simCtx.moveTo(300, 140 + (i * (60 / verticalSteps))); // Distribuye las líneas en la vertical
        simCtx.lineTo(295, 140 + (i * (60 / verticalSteps))); // Pequeño desplazamiento horizontal para visualizar mejor
        simCtx.stroke();
    }


    // Conexiones (líneas de señal)
    simCtx.setLineDash([5, 5]);
    simCtx.strokeStyle = '#000';
    simCtx.beginPath();
    simCtx.moveTo(550, 250);
    simCtx.lineTo(650, 250);
    simCtx.stroke();
    simCtx.beginPath();
    simCtx.moveTo(690, 250);
    simCtx.lineTo(750, 250);
    simCtx.lineTo(750, 100);
    simCtx.lineTo(300, 100);
    simCtx.stroke();
    simCtx.setLineDash([]);
}

// --- FUNCIONES AUXILIARES --- //
function lightenColor(color, factor) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgb(${Math.min(255, r + (255 - r) * factor)}, ${Math.min(255, g + (255 - g) * factor)}, ${Math.min(255, b + (255 - b) * factor)})`;
}

// --- PLOTLY.JS --- //
function initPlot() {
    const traceTemp = {
        x: [],
        y: [],
        name: 'Temperatura Actual (°C)',
        mode: 'lines',
        line: { color: 'blue', width: 2 }
    };
    const traceSetpoint = {
        x: [],
        y: [],
        name: 'Setpoint (°C)',
        mode: 'lines',
        line: { color: 'red', dash: 'dot', width: 2 }
    };
    const traceError = {
        x: [],
        y: [],
        name: 'Error (%)',
        yaxis: 'y2',
        mode: 'lines',
        line: { color: 'green', width: 2 }
    };

    //-------------------
    const layout = {
        title: {
            text: 'Evolución de Temperatura y Error PID',
            font: { size: 12 } // Tamaño de fuente reducido
        },
        xaxis: {
            title: 'Tiempo (s)',
            titlefont: { size: 10 }, // Tamaño de fuente reducido
            tickfont: { size: 9 }    // Tamaño de fuente reducido
        },
        yaxis: {
            title: 'Temperatura (°C)',
            titlefont: { size: 10 },
            tickfont: { size: 9 },
            range: [0, 100]
        },
        yaxis2: {
            title: 'Error (%)',
            titlefont: { size: 10 },
            tickfont: { size: 9 },
            overlaying: 'y',
            side: 'right',
            range: [0, 100]
        },
        legend: {
            orientation: 'h',
            y: -0.2,
            font: { size: 9 } // Tamaño de fuente reducido
        },
        margin: { t: 30, r: 30, l: 50, b: 50 }, // Márgenes reducidos
        plot_bgcolor: '#f9f9f9',
        paper_bgcolor: '#ffffff',
        autosize: true, // Permite que Plotly ajuste automáticamente el tamaño
        width: 500,     // Ancho reducido (70% de 500px)
        height: 400     // Alto reducido (70% de 400px)
    };


    //---------------



    Plotly.newPlot('chartDiv', [traceTemp, traceSetpoint, traceError], layout, { responsive: true });
}

function updatePlot() {
    Plotly.extendTraces('chartDiv', {
        x: [[time], [time], [time]],
        y: [
            [currentTemp],
            [setpoint],
            [Math.abs((setpoint - currentTemp) / setpoint * 100)]
        ]
    }, [0, 1, 2]);
}

// --- LOOP DE ANIMACIÓN --- //
let lastUpdate = 0;
function animate() {
    // Ejecutar la simulación mientras estemos en automático corriendo O en modo manual
    if (!isRunning && !manualMode) return;
    const now = performance.now();
    if (now - lastUpdate >= DT * 1000) {
        simulateStep();
        lastUpdate = now;
    }
    drawSimulation();
    updateDisplays();
    if (steps % 10 === 0) updatePlot();
    requestAnimationFrame(animate);
}

// --- INICIALIZAR --- //
loadConfig();
resetSimulation();

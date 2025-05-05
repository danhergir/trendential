// js/script.js for Trendential Dashboard

// --- Configuration ---
// IMPORTANT: Replace with your actual Supabase URL and Anon Key
const SUPABASE_URL = 'https://cgbaudayowjxicgqijjw.supabase.co'; // e.g., 'https://xyz.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnYmF1ZGF5b3dqeGljZ3Fpamp3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NjM3OTQwMSwiZXhwIjoyMDYxOTU1NDAxfQ.d0PLKznDwMAEvP-4JaiiWvuQA_9b-g0ULJrw17jSAik'; // Public Anon Key

// --- DOM Elements ---
const presidentSelect = document.getElementById('president-select');
const newsList = document.getElementById('news-list');
const currentDateSpan = document.getElementById('current-date');
const prevDayButton = document.getElementById('prev-day');
const nextDayButton = document.getElementById('next-day');
const chartCanvas = document.getElementById('sentimentChart');
const chartLoadingIndicator = document.getElementById('chart-loading');
const chartErrorContainer = document.getElementById('chart-error');
const chartErrorMessage = document.getElementById('chart-error-message');
const chartNoDataContainer = document.getElementById('chart-no-data');
const newsLoadingIndicator = document.getElementById('news-loading');
const noNewsMessage = document.getElementById('no-news-message');
const newsErrorMessage = document.getElementById('news-error-message');

// --- Globals ---
let supabaseClient = null;
let sentimentChart = null;
let currentPresidentId = null;
let currentDate = null; // Initialize later after Day.js check

// --- Initialization ---

/**
 * Initializes the Supabase client.
 */
function initializeSupabase() {
    try {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log("Supabase client initialized successfully.");
        return true;
    } catch (error) {
        console.error("Error initializing Supabase client:", error);
        alert("Failed to initialize Supabase. Check console and config.");
        disableUIOnError('Supabase Init Failed');
        return false;
    }
}

/**
 * Disables key UI elements when a critical error occurs.
 * @param {string} reason - Text to display as reason.
 */
function disableUIOnError(reason = 'Error') {
    presidentSelect.disabled = true;
    prevDayButton.disabled = true;
    nextDayButton.disabled = true;
    presidentSelect.innerHTML = `<option value="">${reason}</option>`;
    currentDateSpan.textContent = reason;
    showNewsError(`${reason}. Functionality disabled.`);
    showChartError(`${reason}. Functionality disabled.`);
    // Ensure buttons also get disabled style
    updatePaginationButtons(false); // Pass false as isPresidentSelected
}


// --- Data Fetching ---

/**
 * Fetches the list of presidents.
 */
async function fetchPresidents() {
    if (!supabaseClient) return;
    console.log("Fetching presidents...");
    try {
        const { data: presidents, error } = await supabaseClient
            .from('presidents')
            .select('*')
            .order('name', { ascending: true });

        if (error) throw error; // Throw error to be caught below

        console.log("Presidents fetched:", presidents);
        presidentSelect.innerHTML = '';

        if (presidents.length === 0) {
             presidentSelect.innerHTML = '<option value="">No presidents found</option>';
             showChartMessage('No presidents found in the database.');
             return;
        }

        const defaultOption = document.createElement('option');
        defaultOption.value = "";
        defaultOption.textContent = "Select a President";
        presidentSelect.appendChild(defaultOption);

        presidents.forEach(president => {
            const option = document.createElement('option');
            option.value = president.id;
            option.textContent = `${president.name || ''} ${president.last_name || ''}`.trim();
            presidentSelect.appendChild(option);
        });

    } catch (err) {
        console.error("Error fetching presidents:", err);
        presidentSelect.innerHTML = '<option value="">Error loading presidents</option>';
        // Also show error in chart area as it depends on presidents
        showChartError(`Failed to load presidents: ${err.message}`);
    }
}

/**
 * Fetches and aggregates sentiment data for a specific president by day.
 * @param {string} presidentId - The ID of the president.
 */
async function fetchSentimentData(presidentId) {
    if (!supabaseClient || !presidentId) return;

    console.log(`Workspaceing sentiment data for president ID: ${presidentId}`);
    showChartLoading();

    try {
        const { data: newsData, error } = await supabaseClient
            .from('news')
            .select('date, sentiment_score')
            .eq('president_id', presidentId)
            .order('date', { ascending: true });

        if (error) throw error; // Throw error to be caught below

        console.log("Raw sentiment data fetched:", newsData);
        const validData = newsData.filter(item => item.date && typeof item.sentiment_score === 'number');

        if (validData.length === 0) {
             console.log("No valid sentiment data found for this president.");
             showChartMessage('No sentiment data available for this president.');
             if (sentimentChart) sentimentChart.destroy();
             sentimentChart = null;
             return;
        }

        const dailySentiment = {};
        validData.forEach(item => {
            const day = dayjs(item.date).format('YYYY-MM-DD');
            if (!dailySentiment[day]) {
                dailySentiment[day] = { sum: 0, count: 0 };
            }
            dailySentiment[day].sum += item.sentiment_score;
            dailySentiment[day].count += 1;
        });

        const aggregatedLabels = Object.keys(dailySentiment).sort();
        const aggregatedScores = aggregatedLabels.map(day => dailySentiment[day].sum / dailySentiment[day].count);

        console.log("Aggregated daily sentiment:", aggregatedLabels.map((l, i) => ({ date: l, avgScore: aggregatedScores[i] })));

        renderSentimentChart(aggregatedLabels, aggregatedScores);
        hideChartOverlays();

    } catch (err) {
        console.error("Error fetching/processing sentiment data:", err);
        showChartError(`Sentiment data error: ${err.message}`);
    }
}


/**
 * Fetches news articles for the currently selected date, joining with president info.
 */
async function fetchNewsForDate(presidentId) {
    if (!supabaseClient || !presidentId) return;

    showNewsLoading();
    currentDateSpan.textContent = currentDate.format('MMMM D, YYYY');

    try {
        const startOfDay = currentDate.startOf('day').format('YYYY-MM-DD');
        const endOfDay = currentDate.endOf('day').format('YYYY-MM-DD');
        
        const { data: newsItems, error } = await supabaseClient
            .from('news')
            .select('*, presidents ( id, name, last_name )')
            .gte('date', startOfDay)
            .lte('date', endOfDay)
            .eq('president_id', presidentId)
            .order('date', { ascending: false });

        if (error) throw error; // Throw error to be caught below

        displayNewsItems(newsItems);

    } catch (err) {
        console.error("Error fetching news for date:", err);
        showNewsError(`Failed to fetch news: ${err.message}`);
    }
}

// --- UI Rendering ---

/**
 * Renders the sentiment trend chart.
 * (Keep the existing renderSentimentChart function - it seems okay)
 */
 function renderSentimentChart(labels, scores) {
    const ctx = chartCanvas.getContext('2d');

    if (sentimentChart) {
        sentimentChart.destroy(); // Clear previous chart instance
    }

    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(79, 70, 229, 0.6)');
    gradient.addColorStop(0.5, 'rgba(124, 58, 237, 0.3)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    sentimentChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels, // Use aggregated labels (unique dates)
            datasets: [{
                label: 'Avg. Daily Sentiment Score', // Label reflects the data
                data: scores, // Use aggregated average scores
                borderColor: 'rgb(79, 70, 229)',
                backgroundColor: gradient,
                tension: 0.3, // Slightly less tension might look better with daily avg
                fill: true,
                pointRadius: 3,
                pointHoverRadius: 7,
                pointBackgroundColor: 'rgb(79, 70, 229)',
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: false,
                    title: { display: true, text: 'Avg. Sentiment Score', font: { size: 14 } },
                    grid: { color: 'rgba(203, 213, 225, 0.5)' },
                    ticks: { color: 'rgb(100, 116, 139)' }
                },
                x: {
                    // If you have many dates, consider using a time scale adapter
                    // type: 'time', // Requires chartjs-adapter-dayjs and registration
                    // time: { unit: 'day' },
                    title: { display: true, text: 'Date', font: { size: 14 } },
                    grid: { display: false },
                    ticks: {
                        color: 'rgb(100, 116, 139)',
                        maxRotation: 70, // Allow more rotation if dates get crowded
                        minRotation: 45,
                        // Auto-skip ticks if there are too many labels
                        autoSkip: true,
                        maxTicksLimit: 15 // Adjust as needed for density
                    }
                }
            },
            plugins: {
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(15, 23, 42, 0.8)',
                    titleFont: { size: 14 },
                    bodyFont: { size: 12 },
                    padding: 10,
                    cornerRadius: 4,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) { label += ': '; }
                            if (context.parsed.y !== null) {
                                // Display average score with 2 decimal places
                                label += context.parsed.y.toFixed(2);
                            }
                            return label;
                        }
                    }
                },
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { color: 'rgb(51, 65, 85)' }
                }
            },
            hover: { mode: 'nearest', intersect: false },
            animation: { duration: 600, easing: 'easeOutCubic' } // Slightly faster animation
        }
    });
}


/**
 * Clears and populates the news list.
 */
function displayNewsItems(newsItems) {
    newsList.innerHTML = '';
    hideNewsMessages();

    if (!Array.isArray(newsItems)) {
        console.error("displayNewsItems received non-array data:", newsItems);
        showNewsError("Invalid data received for news list.");
        return;
    }

    if (newsItems.length === 0) {
        noNewsMessage.classList.remove('hidden');
    } else {
        newsItems.forEach(item => {
            const president = item.presidents;
            const presidentName = president ? `${president.name || ''} ${president.last_name || ''}`.trim() || 'N/A' : 'N/A';
            const newsElement = createNewsElement(item, presidentName);
            newsList.appendChild(newsElement);
        });
    }
}

/**
 * Creates an HTML element for a single news item.
 * Includes timezone info in date display for debugging.
 */
function createNewsElement(newsItem, presidentName) {
    const div = document.createElement('div');
    // Added overflow-hidden just in case content is extremely long, adjust if needed
    div.className = 'p-4 border border-slate-200 rounded-lg bg-slate-100 transition duration-150 ease-in-out overflow-hidden';

    // --- Sentiment Calculation ---
    let sentimentColor = 'text-slate-600'; // Default: Neutral
    let sentimentIcon = 'fa-meh';       // Default: Neutral icon
    let sentimentLabel = 'Neutral';     // Default: Descriptive label

    const score = newsItem.sentiment_score; // This is the float score (0.0 to 4.0)

    // Check if score is a valid number
    if (typeof score === 'number' && !isNaN(score)) {
        // Define thresholds to map the float score back to categories
        // Centered around integer values (0.5, 1.5, 2.5, 3.5)
        if (score < 0.5) {          // Closest to 0 (Very Negative)
            sentimentColor = 'text-red-800 dark:text-red-400'; // Added dark mode example
            sentimentIcon = 'fa-angry';
            sentimentLabel = 'Very Negative';
        } else if (score < 1.5) {   // Closest to 1 (Negative)
            sentimentColor = 'text-red-600 dark:text-red-500';
            sentimentIcon = 'fa-frown';
            sentimentLabel = 'Negative';
        } else if (score < 2.5) {   // Closest to 2 (Neutral)
            sentimentColor = 'text-slate-600 dark:text-slate-400';
            sentimentIcon = 'fa-meh';
            sentimentLabel = 'Neutral';
        } else if (score < 3.5) {   // Closest to 3 (Positive)
            sentimentColor = 'text-green-600 dark:text-green-400';
            sentimentIcon = 'fa-smile';
            sentimentLabel = 'Positive';
        } else {                    // Closest to 4 (Very Positive) (score >= 3.5)
            sentimentColor = 'text-green-800 dark:text-green-300';
            sentimentIcon = 'fa-laugh';
            sentimentLabel = 'Very Positive';
        }
    } else {
        // Handle cases where score is missing or not a number
        sentimentColor = 'text-gray-400 dark:text-gray-500';
        sentimentIcon = 'fa-question-circle';
        sentimentLabel = 'Score unavailable';
    }
    // --- End Sentiment Calculation ---

    // Format other data
    const formattedScore = typeof score === 'number' ? score.toFixed(2) : 'N/A';
    // Use current date/time information for relative formatting if desired, else stick to YYYY-MM-DD
    const formattedDate = newsItem.date ? dayjs(newsItem.date).format('YYYY-MM-DD') : 'N/A';
    // Example using time zone and locale (optional, requires plugins)
    // const formattedDate = newsItem.date ? dayjs(newsItem.date).tz('America/Bogota').locale('es').format('D MMM YYYY') : 'N/A';


    const summaryOrLink = newsItem.url
        ? `<a href="${newsItem.url}" target="_blank" rel="noopener noreferrer" class="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 hover:underline break-words">${newsItem.url}</a>`
        : 'No URL available.';
    const title = newsItem.title || 'No Title Provided'; // Use provided title or fallback

    // Set the innerHTML using the calculated sentiment variables and other data
    // Added title attribute to the sentiment span for hover info
    // Added aria-hidden="true" to decorative icons
    div.innerHTML = `
        <h3 class="text-base font-semibold text-slate-800 text-slate-100 mb-1 break-words">${title}</h3>
        <div class="text-xs text-slate-500 dark:text-slate-400 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span><i class="far fa-calendar-alt mr-1 opacity-80" aria-hidden="true"></i>${formattedDate}</span>
            <span><i class="far fa-user mr-1 opacity-80" aria-hidden="true"></i>${presidentName || 'N/A'}</span>
            <span class="font-medium ${sentimentColor} flex items-center" title="Sentiment: ${sentimentLabel}">
                <i class="fas ${sentimentIcon} mr-1.5" aria-hidden="true"></i>${formattedScore}
            </span>
        </div>
        <p class="text-sm text-slate-600 dark:text-slate-300">${summaryOrLink}</p>
    `;
    return div;
}



// --- UI State Management ---
// (Keep existing functions: showChartLoading, showChartError, showChartMessage,
// hideChartOverlays, showNewsLoading, showNewsError, hideNewsMessages)
function showChartLoading() {
    chartLoadingIndicator.classList.remove('hidden');
    chartErrorContainer.classList.add('hidden');
    chartNoDataContainer.classList.add('hidden');
    chartCanvas.style.opacity = '0.2'; // Dim the canvas area
    chartCanvas.classList.add('invisible'); // Hide canvas content visually
}

function showChartError(message) {
    chartLoadingIndicator.classList.add('hidden');
    chartErrorContainer.classList.remove('hidden');
    chartErrorMessage.textContent = message || 'An error occurred.';
    chartNoDataContainer.classList.add('hidden');
    if (sentimentChart) {
       sentimentChart.destroy();
       sentimentChart = null;
    }
    chartCanvas.style.opacity = '0';
    chartCanvas.classList.add('invisible');
}

function showChartMessage(message) {
    chartLoadingIndicator.classList.add('hidden');
    chartErrorContainer.classList.add('hidden');
    chartNoDataContainer.classList.remove('hidden');
    chartNoDataContainer.querySelector('span').textContent = message || 'No data available.';
     if (sentimentChart) {
       sentimentChart.destroy();
       sentimentChart = null;
    }
    chartCanvas.style.opacity = '0';
    chartCanvas.classList.add('invisible');
}

function hideChartOverlays() {
    chartLoadingIndicator.classList.add('hidden');
    chartErrorContainer.classList.add('hidden');
    chartNoDataContainer.classList.add('hidden');
    chartCanvas.style.opacity = '1';
    chartCanvas.classList.remove('invisible');
}

function showNewsLoading() {
    newsList.innerHTML = ''; // Clear previous content
    newsLoadingIndicator.classList.remove('hidden');
    noNewsMessage.classList.add('hidden');
    newsErrorMessage.classList.add('hidden');
}

function showNewsError(message) {
    newsList.innerHTML = ''; // Clear previous content
    newsLoadingIndicator.classList.add('hidden');
    noNewsMessage.classList.add('hidden');
    newsErrorMessage.classList.remove('hidden');
    // Use textContent for safety against XSS if message comes from error object
    newsErrorMessage.innerHTML = ` <i class="fas fa-exclamation-triangle fa-2x mb-2 text-red-400"></i><br><span id="news-err-text"></span>`;
    document.getElementById('news-err-text').textContent = message || 'Error loading news.';
}

function hideNewsMessages() {
    newsLoadingIndicator.classList.add('hidden');
    noNewsMessage.classList.add('hidden');
    newsErrorMessage.classList.add('hidden');
}


/**
 * Updates the enabled/disabled state and style of pagination buttons.
 * @param {boolean} isPresidentSelected - Whether a president is currently selected.
 */
function updatePaginationButtons(isPresidentSelected) {
    // Buttons are disabled if no president is selected
    prevDayButton.disabled = !isPresidentSelected;

    // Next button is disabled if no president OR if the date is today/future
    const today = dayjs().startOf('day');
    const isNextDisabled = !isPresidentSelected || (currentDate && (currentDate.isSame(today, 'day') || currentDate.isAfter(today)));
    nextDayButton.disabled = isNextDisabled;

    // Apply visual styling for disabled state (using Tailwind classes)
    prevDayButton.classList.toggle('opacity-50', prevDayButton.disabled);
    prevDayButton.classList.toggle('cursor-not-allowed', prevDayButton.disabled);
    nextDayButton.classList.toggle('opacity-50', nextDayButton.disabled);
    nextDayButton.classList.toggle('cursor-not-allowed', nextDayButton.disabled);
}


// --- Event Listeners ---

presidentSelect.addEventListener('change', (event) => {
    currentPresidentId = event.target.value;
    const presidentIsSelected = !!currentPresidentId; // Boolean flag

    // Enable/disable pagination buttons based on selection
    updatePaginationButtons(presidentIsSelected);

    if (presidentIsSelected) {
        fetchSentimentData(currentPresidentId);
        fetchNewsForDate(currentPresidentId);
    } else {
        // Clear chart if "Select President" is chosen
        if (sentimentChart) {
            sentimentChart.destroy();
            sentimentChart = null;
        }
        showChartMessage('Please select a president to view the sentiment trend.');
        newsList.innerHTML = '';
        hideNewsMessages();
        noNewsMessage.classList.remove('hidden');
        noNewsMessage.textContent = "Select a president to view news.";
    }
});

prevDayButton.addEventListener('click', () => {
    // Double check disabled state just in case
    if (prevDayButton.disabled || !currentDate) return;
    currentDate = currentDate.subtract(1, 'day');
    fetchNewsForDate(currentPresidentId);
    updatePaginationButtons(true); // Re-check next button state
});

nextDayButton.addEventListener('click', () => {
    // Double check disabled state just in case
    if (nextDayButton.disabled || !currentDate) return;
    currentDate = currentDate.add(1, 'day');
    fetchNewsForDate(currentPresidentId);
    updatePaginationButtons(true); // Re-check next button state
});

// --- Initial Load ---

document.addEventListener('DOMContentLoaded', () => {
    // Now it's safe to initialize currentDate
    currentDate = dayjs().startOf('day');
    currentDateSpan.textContent = currentDate.format('MMMM D, YYYY'); // Set initial date display

    if (initializeSupabase()) {
        fetchPresidents(); // Load presidents dropdown
        // fetchNewsForDate(); // Fetch news for the initial date (today) - will only run if currentDate is set
        showChartMessage('Please select a president to view the sentiment trend.');
        // Initial button state: disabled as no president is selected yet
        updatePaginationButtons(false);
    } else {
        console.warn("Supabase not initialized. Dashboard functionality limited.");
        // UI elements are disabled within initializeSupabase/disableUIOnError
    }
});

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
let currentDate = dayjs().startOf('day');

// --- Initialization ---

/**
 * Initializes the Supabase client.
 * Shows an alert and disables functionality if initialization fails.
 */
function initializeSupabase() {
    // Check if Supabase global object exists first
    if (typeof supabase === 'undefined') {
         console.error('Supabase client library not loaded. Check the script tag in index.html.');
         alert('Error: Supabase library failed to load.');
         // Disable UI elements
         presidentSelect.disabled = true;
         prevDayButton.disabled = true;
         nextDayButton.disabled = true;
         presidentSelect.innerHTML = '<option value="">Load Error</option>';
         currentDateSpan.textContent = 'Error';
         showNewsError('Library load failed.');
         showChartError('Library load failed.');
         return false; // Indicate failure
    }

    // Check for placeholder configuration values
    if (SUPABASE_URL === 'YOUR_SUPABASE_URL' || SUPABASE_ANON_KEY === 'YOUR_PUBLIC_ANON_KEY' || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.error('Supabase URL or Anon Key is not configured in js/script.js.');
        alert('Configuration Error: Supabase URL or Key is missing or incorrect. Please check js/script.js.');
        // Disable UI elements to prevent errors
        presidentSelect.disabled = true;
        prevDayButton.disabled = true;
        nextDayButton.disabled = true;
        presidentSelect.innerHTML = '<option value="">Config Error</option>';
        currentDateSpan.textContent = 'Error';
        showNewsError('Configuration Error.');
        showChartError('Configuration Error.');
        // Add security warning specifically for the key
        if (SUPABASE_ANON_KEY.length > 100 && SUPABASE_ANON_KEY.includes('service_role')) { // Basic check
             alert('SECURITY WARNING: You might be using a Service Role Key in the client-side code. Please use the public Anon Key.');
        }
        return false; // Indicate failure
    }


    try {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log("Supabase client initialized successfully.");
        return true; // Indicate success
    } catch (error) {
        console.error("Error initializing Supabase client:", error);
        alert("Failed to initialize Supabase. Please check console and configuration.");
        // Disable UI elements
        presidentSelect.disabled = true;
        prevDayButton.disabled = true;
        nextDayButton.disabled = true;
        presidentSelect.innerHTML = '<option value="">Init Error</option>';
        currentDateSpan.textContent = 'Error';
        showNewsError('Initialization failed.');
        showChartError('Initialization failed.');
        return false; // Indicate failure
    }
}

// --- Data Fetching ---

/**
 * Fetches the list of presidents from the 'presidents' table.
 */
async function fetchPresidents() {
    if (!supabaseClient) return;
    console.log("Fetching presidents...");
    try {
        // Select only needed columns
        const { data: presidents, error } = await supabaseClient
            .from('presidents')
            .select('id, name, last_name') // Specify columns
            .order('name', { ascending: true });

        if (error) {
            console.error('Error fetching presidents:', error);
            presidentSelect.innerHTML = '<option value="">Error loading</option>';
            showChartError('Could not load presidents.');
            return;
        }

        console.log("Presidents fetched:", presidents);
        presidentSelect.innerHTML = ''; // Clear loading/error

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
            // Ensure both name and last_name exist before combining
            option.textContent = `${president.name || ''} ${president.last_name || ''}`.trim();
            presidentSelect.appendChild(option);
        });

    } catch (err) {
        console.error("Unexpected error in fetchPresidents:", err);
        presidentSelect.innerHTML = '<option value="">Error loading</option>';
        showChartError('An unexpected error occurred loading presidents.');
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
        // Fetch all relevant news data for the selected president
        const { data: newsData, error } = await supabaseClient
            .from('news')
            .select('date, sentiment_score') // Only fetch needed columns
            .eq('president_id', presidentId)
            .order('date', { ascending: true });

        if (error) {
            console.error('Error fetching sentiment data:', error);
            showChartError(`Error fetching sentiment data: ${error.message}`);
            return;
        }

        console.log("Raw sentiment data fetched:", newsData);

        // Filter out invalid data points first
        const validData = newsData.filter(item => item.date && typeof item.sentiment_score === 'number');

        if (validData.length === 0) {
             console.log("No valid sentiment data found for this president.");
             showChartMessage('No sentiment data available for this president.');
             if (sentimentChart) sentimentChart.destroy();
             sentimentChart = null;
             return;
        }

        // --- FIX: Aggregate data by day ---
        const dailySentiment = {}; // Use an object to group by date { 'YYYY-MM-DD': { sum: X, count: Y } }

        validData.forEach(item => {
            const day = dayjs(item.date).format('YYYY-MM-DD'); // Group by day
            if (!dailySentiment[day]) {
                dailySentiment[day] = { sum: 0, count: 0 };
            }
            dailySentiment[day].sum += item.sentiment_score;
            dailySentiment[day].count += 1;
        });

        // --- FIX: Prepare aggregated data for the chart ---
        const aggregatedLabels = Object.keys(dailySentiment).sort(); // Sort dates chronologically
        const aggregatedScores = aggregatedLabels.map(day => {
            const { sum, count } = dailySentiment[day];
            return sum / count; // Calculate the average
        });

        console.log("Aggregated daily sentiment:", aggregatedLabels.map((l, i) => ({ date: l, avgScore: aggregatedScores[i] })));

        // Render chart with aggregated data
        renderSentimentChart(aggregatedLabels, aggregatedScores);
        hideChartOverlays();

    } catch (err) {
        console.error("Unexpected error in fetchSentimentData:", err);
        showChartError('An unexpected error occurred processing sentiment data.');
    }
}


/**
 * Fetches news articles for the currently selected date, joining with president info.
 */
async function fetchNewsForDate() {
    if (!supabaseClient) return;

    const dateStr = currentDate.format('YYYY-MM-DD');
    console.log(`Workspaceing news for date: ${dateStr}`);

    showNewsLoading();
    currentDateSpan.textContent = currentDate.format('MMMM D, YYYY'); // Correct format
    updatePaginationButtons();

    try {
        const startOfDay = currentDate.startOf('day').toISOString();
        const endOfDay = currentDate.endOf('day').toISOString();

        console.log(`Querying between ${startOfDay} and ${endOfDay}`);

        // --- FIX: Join with presidents table ---
        const { data: newsItems, error } = await supabaseClient
            .from('news')
            // Select specific columns from news and all columns (*) or specific ones from presidents
            .select(`
                *,
                presidents ( id, name, last_name )
            `)
            .gte('date', startOfDay)
            .lte('date', endOfDay)
            .order('date', { ascending: false }); // Show newest first for the day

        if (error) {
            console.error('Error fetching news:', error);
            showNewsError(`Error fetching news: ${error.message}`);
            return;
        }

        console.log("News items fetched for date:", newsItems);
        displayNewsItems(newsItems);

    } catch (err) {
        console.error("Unexpected error in fetchNewsForDate:", err);
        showNewsError('An unexpected error occurred fetching news.');
    }
}

// --- UI Rendering ---

/**
 * Renders the sentiment trend chart using Chart.js with enhanced visuals.
 * Uses aggregated daily average scores.
 * @param {string[]} labels - Array of unique date strings (YYYY-MM-DD) for the x-axis.
 * @param {number[]} scores - Array of corresponding average sentiment scores for the y-axis.
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
 * Clears and populates the news list with fetched items.
 * @param {Array} newsItems - Array of news data objects (including joined president data).
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
            // --- FIX: Access joined president data safely ---
            const president = item.presidents; // Get the nested president object
            const presidentName = president
                ? `${president.name || ''} ${president.last_name || ''}`.trim() || 'N/A'
                : 'N/A'; // Handle if president data is missing or name is empty

            const newsElement = createNewsElement(item, presidentName);
            newsList.appendChild(newsElement);
        });
    }
}

/**
 * Creates an HTML element for a single news item.
 * @param {object} newsItem - The news data object.
 * @param {string} presidentName - The formatted president name (passed from displayNewsItems).
 * @returns {HTMLElement} - The created div element.
 */
function createNewsElement(newsItem, presidentName) { // presidentName is now correctly passed
    const div = document.createElement('div');
    div.className = 'p-4 border border-slate-200 rounded-lg bg-slate-50/50 hover:bg-slate-100 transition duration-150 ease-in-out';

    let sentimentColor = 'text-slate-600';
    let sentimentIcon = 'fa-meh'; // Neutral icon
    const score = newsItem.sentiment_score;

    if (typeof score === 'number') {
        if (score > 0.2) { // Threshold for positive
            sentimentColor = 'text-green-600';
            sentimentIcon = 'fa-smile';
        } else if (score < -0.2) { // Threshold for negative
            sentimentColor = 'text-red-600';
            sentimentIcon = 'fa-frown';
        }
        // Scores between -0.2 and 0.2 remain neutral
    }

    const formattedScore = typeof score === 'number' ? score.toFixed(2) : 'N/A';
    const formattedDate = newsItem.date ? dayjs(newsItem.date).format('YYYY-MM-DD') : 'N/A';

    // Use newsItem.url for the link/summary display
    const summaryOrLink = newsItem.url
        ? `<a href="${newsItem.url}" target="_blank" rel="noopener noreferrer" class="text-indigo-600 hover:text-indigo-800 hover:underline break-words">${newsItem.url}</a>` // Use break-words
        : 'No URL available.';

    // Safely access title, provide default
    const title = newsItem.title || 'No Title Provided';

    div.innerHTML = `
        <h3 class="text-base font-semibold text-slate-800 mb-1">${title}</h3>
        <div class="text-xs text-slate-500 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span><i class="far fa-calendar-alt mr-1 opacity-80"></i>${formattedDate}</span>
            <span><i class="far fa-user mr-1 opacity-80"></i>${presidentName}</span>
            <span class="font-medium ${sentimentColor} flex items-center">
                <i class="fas ${sentimentIcon} mr-1.5"></i>${formattedScore} </span>
        </div>
        <p class="text-sm text-slate-600">${summaryOrLink}</p>
    `;
    return div;
}


// --- UI State Management (Loading, Error, Messages) ---
// (Keep existing functions: showChartLoading, showChartError, showChartMessage,
// hideChartOverlays, showNewsLoading, showNewsError, hideNewsMessages,
// updatePaginationButtons - they seem okay)

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
 * Updates the state (enabled/disabled) of pagination buttons.
 * Disables next button if current date is today or later.
 */
function updatePaginationButtons() {
    const today = dayjs().startOf('day');
    // Disable next button if currentDate is today or any future date
    nextDayButton.disabled = currentDate.isSame(today, 'day') || currentDate.isAfter(today);
    // Prev button generally always enabled unless you add a specific limit
    prevDayButton.disabled = false;

    // Style disabled buttons using Tailwind classes (ensure these are in your CSS/HTML)
    nextDayButton.classList.toggle('opacity-50', nextDayButton.disabled);
    nextDayButton.classList.toggle('cursor-not-allowed', nextDayButton.disabled);
    // prevDayButton.classList.toggle('opacity-50', prevDayButton.disabled);
    // prevDayButton.classList.toggle('cursor-not-allowed', prevDayButton.disabled);
}


// --- Event Listeners ---

presidentSelect.addEventListener('change', (event) => {
    currentPresidentId = event.target.value;
    if (currentPresidentId) {
        fetchSentimentData(currentPresidentId);
    } else {
        // Clear chart if "Select President" is chosen
        if (sentimentChart) {
            sentimentChart.destroy();
            sentimentChart = null;
        }
        // Show placeholder message instead of error
        showChartMessage('Please select a president to view the sentiment trend.');
    }
});

prevDayButton.addEventListener('click', () => {
    if (prevDayButton.disabled) return; // Prevent action if disabled
    currentDate = currentDate.subtract(1, 'day');
    fetchNewsForDate(); // Refetch news for the new date
});

nextDayButton.addEventListener('click', () => {
    if (nextDayButton.disabled) return; // Prevent action if disabled
    currentDate = currentDate.add(1, 'day');
    fetchNewsForDate(); // Refetch news for the new date
});

// --- Initial Load ---

document.addEventListener('DOMContentLoaded', () => {
    // Ensure Day.js is loaded before using it
    if (typeof dayjs === 'undefined') {
        console.error("Day.js library not loaded!");
        alert("Error: Day.js library failed to load. Dashboard cannot function.");
        // Optionally disable UI elements
        currentDateSpan.textContent = 'Error';
        prevDayButton.disabled = true;
        nextDayButton.disabled = true;
        return; // Stop initialization
    }

    currentDate = dayjs().startOf('day'); // Initialize date *after* ensuring dayjs exists

    if (initializeSupabase()) {
        fetchPresidents(); // Load presidents dropdown
        fetchNewsForDate(); // Fetch news for the initial date (today)
        // Initial chart state: prompt user to select president
        showChartMessage('Please select a president to view the sentiment trend.');
    } else {
        console.warn("Supabase not initialized. Dashboard functionality limited.");
        // UI elements are disabled within initializeSupabase on failure
    }
});

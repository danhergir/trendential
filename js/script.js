// js/script.js for Trendential Dashboard

// --- Configuration ---
// IMPORTANT: Replace with your actual Supabase URL and Anon Key if different
const SUPABASE_URL = 'https://cgbaudayowjxicgqijjw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnYmF1ZGF5b3dqeGljZ3Fpamp3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NjM3OTQwMSwiZXhwIjoyMDYxOTU1NDAxfQ.d0PLKznDwMAEvP-4JaiiWvuQA_9b-g0ULJrw17jSAik'; // Using the service key - BE CAREFUL exposing this client-side in production

// --- DOM Elements ---
const presidentSearchInput = document.getElementById('president-search');
const presidentResultsContainer = document.getElementById('president-results');
const selectedPresidentIdInput = document.getElementById('selected-president-id');
const presidentLoadingIndicator = document.getElementById('president-loading');
const presidentNoResultsIndicator = document.getElementById('president-no-results');

const newsList = document.getElementById('news-list');
const currentDateSpan = document.getElementById('current-date');
const prevDayButton = document.getElementById('prev-day');
const nextDayButton = document.getElementById('next-day');
const chartCanvas = document.getElementById('sentimentChart');
const chartLoadingIndicator = document.getElementById('chart-loading');
const chartErrorContainer = document.getElementById('chart-error');
const chartErrorMessage = document.getElementById('chart-error-message');
const chartNoDataContainer = document.getElementById('chart-no-data');
const chartNoDataMessage = document.getElementById('chart-no-data-message'); // Get the span inside
const newsLoadingIndicator = document.getElementById('news-loading');
const noNewsMessage = document.getElementById('no-news-message');
const noNewsText = document.getElementById('no-news-text'); // Get the span inside
const newsErrorMessage = document.getElementById('news-error-message');
const newsErrorText = document.getElementById('news-err-text'); // Get the span inside

// --- Globals ---
let supabaseClient = null;
let sentimentChart = null;
let currentDate = null; // Initialize later after Day.js check
let allPresidents = []; // Array to store all fetched presidents
let presidentFetchController = null; // To abort previous fetches if needed
let focusedResultIndex = -1; // For keyboard navigation

// --- Initialization ---

/**
 * Initializes the Supabase client.
 */
function initializeSupabase() {
    try {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
             throw new Error("Supabase URL or Key is missing.");
        }
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log("Supabase client initialized successfully.");
        return true;
    } catch (error) {
        console.error("Error initializing Supabase client:", error);
        alert(`Failed to initialize Supabase: ${error.message}. Check console and config.`);
        disableUIOnError('Supabase Init Failed');
        return false;
    }
}

/**
 * Disables key UI elements when a critical error occurs.
 * @param {string} reason - Text to display as reason.
 */
function disableUIOnError(reason = 'Error') {
    presidentSearchInput.disabled = true;
    prevDayButton.disabled = true;
    nextDayButton.disabled = true;
    presidentSearchInput.placeholder = reason;
    currentDateSpan.textContent = reason;
    showNewsError(`${reason}. Functionality disabled.`);
    showChartError(`${reason}. Functionality disabled.`);
    updatePaginationButtons(false);
}


// --- Data Fetching ---

/**
 * Fetches the list of presidents and stores them.
 */
async function fetchPresidents() {
    if (!supabaseClient) return;
    console.log("Fetching presidents...");
    presidentSearchInput.placeholder = "Loading presidents...";
    presidentSearchInput.disabled = true; // Disable while fetching
    // Don't show dropdown just for loading text

    // Abort previous fetch if any
    if (presidentFetchController) {
        presidentFetchController.abort();
    }
    presidentFetchController = new AbortController();
    const { signal } = presidentFetchController;

    try {
        const { data: presidents, error } = await supabaseClient
            .from('presidents')
            .select('id, name, last_name')
            .order('name', { ascending: true })
            .abortSignal(signal);

        presidentFetchController = null; // Reset controller

        if (error) {
            if (error.name === 'AbortError') {
                 console.log('President fetch aborted');
                 return;
            }
            throw error;
        }

        console.log("Presidents fetched:", presidents);
        allPresidents = presidents.map(p => ({
            id: p.id,
            name: `${p.name || ''} ${p.last_name || ''}`.trim()
        })).filter(p => p.name);

        if (allPresidents.length === 0) {
             console.warn("No presidents found in the database.");
             presidentSearchInput.placeholder = "No presidents available";
             presidentSearchInput.disabled = true;
             showChartMessage('No presidents found in the database.');
             return;
        }

        // Presidents fetched, enable input
        presidentSearchInput.disabled = false;
        presidentSearchInput.placeholder = "Type to search presidents...";

    } catch (err) {
         presidentFetchController = null;
        if (err.name !== 'AbortError') {
            console.error("Error fetching presidents:", err);
            presidentSearchInput.placeholder = "Error loading presidents";
            presidentSearchInput.disabled = true;
            showChartError(`Failed to load presidents: ${err.message}`);
             // Show error in dropdown temporarily if user tries to type
            presidentNoResultsIndicator.textContent = 'Error loading presidents.';
        }
    }
}

/**
 * Fetches and aggregates sentiment data for a specific president by day.
 * @param {string} presidentId - The ID of the president.
 */
async function fetchSentimentData(presidentId) {
    if (!supabaseClient || !presidentId) {
        showChartMessage('Invalid president ID provided.');
        return;
    }

    console.log(`Workspaceing sentiment data for president ID: ${presidentId}`);
    showChartLoading();

    try {
        const { data: newsData, error } = await supabaseClient
            .from('news')
            .select('date, sentiment_score')
            .eq('president_id', presidentId)
            .not('sentiment_score', 'is', null) // Ensure score is not null
            .order('date', { ascending: true });

        if (error) throw error;

        console.log("Raw sentiment data fetched:", newsData);
        const validData = newsData.filter(item => item.date && typeof item.sentiment_score === 'number');

        if (validData.length === 0) {
             console.log("No valid sentiment data found for this president.");
             showChartMessage('No sentiment data available for this president.');
             if (sentimentChart) {
                 sentimentChart.destroy();
                 sentimentChart = null;
             }
             return;
        }

        const dailySentiment = {};
        validData.forEach(item => {
            // Parse date correctly, assuming it's stored as date or timestamp
            // Using UTC to avoid timezone issues during aggregation by day
            const day = dayjs.utc(item.date).format('YYYY-MM-DD');
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
        showChartError(`Sentiment data error: ${err.message || 'Unknown error'}`);
    }
}


/**
 * Fetches news articles for the currently selected date and president.
 * @param {string} presidentId - The ID of the president.
 */
async function fetchNewsForDate(presidentId) {
    if (!supabaseClient || !presidentId || !currentDate) {
         showNewsError('Missing president ID or date for fetching news.');
         return;
    }

    showNewsLoading();
    currentDateSpan.textContent = currentDate.format('MMMM D, YYYY'); // Consistent format

    try {
        // Use ISO strings which Supabase typically handles well for timestamp[tz]
        const startOfDay = currentDate.startOf('day').toISOString();
        const endOfDay = currentDate.endOf('day').toISOString();

        console.log(`Workspaceing news for ${presidentId} between ${startOfDay} and ${endOfDay}`);

        const { data: newsItems, error } = await supabaseClient
            .from('news')
            // Select specific columns for efficiency, including president details
            .select(`
                id,
                title,
                url,
                date,
                sentiment_score,
                presidents ( id, name, last_name )
            `)
            .gte('date', startOfDay)
            .lte('date', endOfDay)
            .eq('president_id', presidentId)
            .order('date', { ascending: false }); // Show newest first for the day

        if (error) throw error;

        displayNewsItems(newsItems);

    } catch (err) {
        console.error("Error fetching news for date:", err);
        showNewsError(`Failed to fetch news: ${err.message || 'Unknown error'}`);
    }
}

// --- UI Rendering ---

/**
 * Renders the sentiment trend chart.
 */
function renderSentimentChart(labels, scores) {
    if (!chartCanvas) return;
    const ctx = chartCanvas.getContext('2d');

    if (sentimentChart) {
        sentimentChart.destroy(); // Clear previous chart instance
    }

    // Enhanced Gradient for better visibility on dark bg
    const gradient = ctx.createLinearGradient(0, 0, 0, 450);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.7)'); // Indigo-500 slightly more opaque
    gradient.addColorStop(0.6, 'rgba(124, 58, 237, 0.3)'); // Purple-600
    gradient.addColorStop(1, 'rgba(30, 41, 59, 0)');   // slate-800 (chart bg color) almost transparent

    sentimentChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels, // Dates (YYYY-MM-DD)
            datasets: [{
                label: 'Avg. Daily Sentiment Score',
                data: scores, // Corresponding scores
                borderColor: 'rgb(124, 58, 237)', // Purple-600
                backgroundColor: gradient,
                tension: 0.3,
                fill: true,
                pointRadius: 3,
                pointHoverRadius: 6,
                pointBackgroundColor: 'rgb(124, 58, 237)',
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: false, // Scores might hover around neutral
                    // Suggest min/max based on your scale (0-4) if data range is small
                    // suggestedMin: 0,
                    // suggestedMax: 4.5,
                    title: {
                        display: true,
                        text: 'Avg. Sentiment Score',
                        font: { size: 14, weight: '500' },
                        color: '#94a3b8' // slate-400
                    },
                    grid: { color: 'rgba(51, 65, 85, 0.7)' }, // slate-700 with opacity
                    ticks: { color: '#94a3b8' } // slate-400
                },
                x: {
                    // Consider using a time scale if dates are numerous
                    // Requires chartjs-adapter-dayjs:
                    // import dayjs from 'dayjs';
                    // import 'chartjs-adapter-dayjs'; (Need to bundle or use CDN)
                    // type: 'time',
                    // time: { unit: 'day' },
                    title: {
                        display: true,
                        text: 'Date',
                        font: { size: 14, weight: '500' },
                        color: '#94a3b8'
                    },
                    grid: { display: false },
                    ticks: {
                        color: '#94a3b8',
                        maxRotation: 70,
                        minRotation: 45,
                        autoSkip: true,
                        maxTicksLimit: 15 // Adjust based on chart width
                    }
                }
            },
            plugins: {
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(15, 23, 42, 0.9)', // slate-900 more opaque
                    titleFont: { size: 14 },
                    bodyFont: { size: 12 },
                    padding: 10,
                    cornerRadius: 4,
                    titleColor: '#e2e8f0', // slate-200
                    bodyColor: '#cbd5e1', // slate-300
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
                    labels: { color: '#94a3b8' } // slate-400
                }
            },
            hover: { mode: 'nearest', intersect: false },
            animation: { duration: 600, easing: 'easeOutCubic' }
        }
    });
}


/**
 * Clears and populates the news list.
 */
function displayNewsItems(newsItems) {
    newsList.innerHTML = ''; // Clear previous items and messages
    hideNewsMessages(); // Ensure all messages are hidden initially

    if (!Array.isArray(newsItems)) {
        console.error("displayNewsItems received non-array data:", newsItems);
        showNewsError("Invalid data received for news list.");
        return;
    }

    if (newsItems.length === 0) {
        noNewsMessage.classList.remove('hidden');
        noNewsText.textContent = "No news articles found for this date."; // Specific message
    } else {
        newsItems.forEach(item => {
            const president = item.presidents;
            // Ensure president info is extracted correctly even if name/last_name are null
            const presidentName = president ? `${president.name || ''} ${president.last_name || ''}`.trim() || 'N/A' : 'N/A';
            const newsElement = createNewsElement(item, presidentName);
            newsList.appendChild(newsElement);
        });
    }
}

/**
 * Creates an HTML element for a single news item.
 */
function createNewsElement(newsItem, presidentName) {
    const div = document.createElement('div');
    // Use Tailwind classes directly for styling the card
    div.className = 'news-card p-4 border border-slate-200 rounded-lg bg-slate-100 transition duration-150 ease-in-out overflow-hidden shadow'; // Added shadow

    // --- Sentiment Calculation ---
    let sentimentColor = 'text-slate-600'; // Neutral
    let sentimentIcon = 'fa-meh';          // Neutral
    let sentimentLabel = 'Neutral';

    const score = newsItem.sentiment_score;

    if (typeof score === 'number' && !isNaN(score)) {
        // Mapping float score (0.0 to 4.0) back to categories
        if (score < 0.5) {         // ~0: Very Negative
            sentimentColor = 'text-red-700'; // Darker red for contrast on light bg
            sentimentIcon = 'fa-angry';
            sentimentLabel = 'Very Negative';
        } else if (score < 1.5) {  // ~1: Negative
            sentimentColor = 'text-red-600';
            sentimentIcon = 'fa-frown';
            sentimentLabel = 'Negative';
        } else if (score < 2.5) {  // ~2: Neutral
            sentimentColor = 'text-slate-600';
            sentimentIcon = 'fa-meh';
            sentimentLabel = 'Neutral';
        } else if (score < 3.5) {  // ~3: Positive
            sentimentColor = 'text-green-600';
            sentimentIcon = 'fa-smile';
            sentimentLabel = 'Positive';
        } else {                   // ~4: Very Positive
            sentimentColor = 'text-green-700'; // Darker green
            sentimentIcon = 'fa-laugh';
            sentimentLabel = 'Very Positive';
        }
    } else { // Handle missing/invalid score
        sentimentColor = 'text-gray-400';
        sentimentIcon = 'fa-question-circle';
        sentimentLabel = 'Score unavailable';
    }
    // --- End Sentiment Calculation ---

    const formattedScore = typeof score === 'number' ? score.toFixed(2) : 'N/A';
    // Format date using Day.js - show time if available, otherwise just date
    // Assumes 'date' field might be a timestamp or just a date string
    const formattedDate = newsItem.date
        ? dayjs(newsItem.date).format('YYYY-MM-DD HH:mm') // Adjust format as needed
        : 'N/A';

    const summaryOrLink = newsItem.url
        ? `<a href="${newsItem.url}" target="_blank" rel="noopener noreferrer" class="text-indigo-600 hover:text-indigo-800 hover:underline break-words">${newsItem.url}</a>`
        : '<span class="text-slate-500">No URL available.</span>'; // Style non-link text

    const title = newsItem.title || 'No Title Provided';

    div.innerHTML = `
        <h3 class="text-base font-semibold text-slate-800 mb-1 break-words">${title}</h3>
        <div class="text-xs text-slate-500 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span><i class="far fa-calendar-alt mr-1 opacity-80" aria-hidden="true"></i>${formattedDate}</span>
            <span><i class="far fa-user mr-1 opacity-80" aria-hidden="true"></i>${presidentName}</span>
            <span class="font-medium ${sentimentColor} flex items-center" title="Sentiment: ${sentimentLabel} (${formattedScore})">
                <i class="fas ${sentimentIcon} mr-1.5" aria-hidden="true"></i>${formattedScore}
            </span>
        </div>
        <p class="text-sm text-slate-600">${summaryOrLink}</p>
    `;
    return div;
}


// --- Autocomplete UI ---

function showPresidentLoading() {
    presidentLoadingIndicator.classList.remove('hidden');
    presidentNoResultsIndicator.classList.add('hidden');
    presidentResultsContainer.innerHTML = ''; // Clear previous results
    presidentResultsContainer.appendChild(presidentLoadingIndicator); // Ensure it's inside
     presidentResultsContainer.appendChild(presidentNoResultsIndicator); // Keep structure
    presidentResultsContainer.classList.remove('hidden'); // Show container
    presidentSearchInput.setAttribute('aria-expanded', 'true');
}

function hidePresidentLoading() {
    presidentLoadingIndicator.classList.add('hidden');
}

function showPresidentNoResults() {
    presidentNoResultsIndicator.classList.remove('hidden');
    presidentLoadingIndicator.classList.add('hidden');
    presidentResultsContainer.innerHTML = ''; // Clear previous results
    presidentResultsContainer.appendChild(presidentLoadingIndicator); // Keep structure
     presidentResultsContainer.appendChild(presidentNoResultsIndicator); // Show it
    presidentResultsContainer.classList.remove('hidden'); // Keep container open
    presidentSearchInput.setAttribute('aria-expanded', 'true');
}

function hidePresidentResults() {
    presidentResultsContainer.classList.add('hidden');
    presidentSearchInput.setAttribute('aria-expanded', 'false');
    hidePresidentLoading();
    presidentNoResultsIndicator.classList.add('hidden');
     focusedResultIndex = -1; // Reset keyboard focus index when hiding
}

/**
 * Filters presidents based on input and renders results.
 */
function filterAndRenderPresidents(searchTerm) {
    if (!allPresidents || allPresidents.length === 0) {
         hidePresidentResults();
         return;
    }

    const lowerCaseSearchTerm = searchTerm.toLowerCase().trim();

    // Clear previous visual focus
    focusedResultIndex = -1;
    // Clear previous results before adding new ones or showing no results
    presidentResultsContainer.innerHTML = '';
    // Re-attach loading/no-results divs to maintain structure for show/hide logic
    presidentResultsContainer.appendChild(presidentLoadingIndicator);
    presidentResultsContainer.appendChild(presidentNoResultsIndicator);
    hidePresidentLoading();
    presidentNoResultsIndicator.classList.add('hidden');

    if (!lowerCaseSearchTerm) {
        hidePresidentResults(); // Hide if input is empty
        return;
    }

    const filteredPresidents = allPresidents.filter(president =>
        president.name.toLowerCase().includes(lowerCaseSearchTerm)
    );


    if (filteredPresidents.length === 0) {
        showPresidentNoResults();
    } else {
        presidentResultsContainer.classList.remove('hidden');
        presidentSearchInput.setAttribute('aria-expanded', 'true');

        filteredPresidents.forEach(president => {
            const item = document.createElement('div');
            // Added text-slate-100 for better contrast on slate-700 bg
            item.className = 'p-3 hover:bg-slate-600 cursor-pointer text-sm text-slate-100 rounded'; // Added rounded
            item.setAttribute('role', 'option');
            item.dataset.id = president.id;
            item.dataset.name = president.name;

            // Highlight matching text
            const index = president.name.toLowerCase().indexOf(lowerCaseSearchTerm);
            if (index !== -1) {
                item.innerHTML = president.name.substring(0, index) +
                                '<strong class="font-bold">' + president.name.substring(index, index + lowerCaseSearchTerm.length) + '</strong>' +
                                president.name.substring(index + lowerCaseSearchTerm.length);
            } else {
                 item.textContent = president.name; // Fallback if no match somehow
            }

            // Click listener
            item.addEventListener('click', () => {
                 selectPresident(president.id, president.name);
            });

            presidentResultsContainer.appendChild(item);
        });
    }
}

/**
 * Handles selecting a president from the results.
 */
function selectPresident(id, name) {
    if (!id || !name) return; // Basic validation

    console.log(`President selected: ID=${id}, Name=${name}`);
    presidentSearchInput.value = name;
    selectedPresidentIdInput.value = id;
    hidePresidentResults();

    const presidentIsSelected = true;
    updatePaginationButtons(presidentIsSelected);

    // Trigger data fetching only if ID is valid
    fetchSentimentData(id);
    fetchNewsForDate(id);
}

/**
 * Clears the current president selection and related data.
 */
function clearPresidentSelection() {
     console.log("Clearing president selection.");
     presidentSearchInput.value = '';
     selectedPresidentIdInput.value = '';
     hidePresidentResults(); // Ensure dropdown is closed

     // Clear chart and show placeholder message
     if (sentimentChart) {
         sentimentChart.destroy();
         sentimentChart = null;
     }
     showChartMessage('Please select a president to view the sentiment trend.');

     // Clear news and show placeholder message
     newsList.innerHTML = '';
     hideNewsMessages();
     noNewsMessage.classList.remove('hidden');
     noNewsText.textContent = "Select a president to view news.";

     // Disable pagination
     updatePaginationButtons(false);
}


// --- UI State Management (Chart & News) ---

function showChartLoading() {
    chartLoadingIndicator.classList.remove('hidden');
    chartErrorContainer.classList.add('hidden');
    chartNoDataContainer.classList.add('hidden');
    chartCanvas.classList.add('opacity-20', 'invisible'); // Use Tailwind classes
}

function showChartError(message) {
    chartLoadingIndicator.classList.add('hidden');
    chartErrorContainer.classList.remove('hidden');
    chartErrorMessage.textContent = message || 'An error occurred loading the chart.';
    chartNoDataContainer.classList.add('hidden');
    if (sentimentChart) {
        sentimentChart.destroy();
        sentimentChart = null;
    }
    chartCanvas.classList.add('opacity-0', 'invisible');
}

function showChartMessage(message) {
    chartLoadingIndicator.classList.add('hidden');
    chartErrorContainer.classList.add('hidden');
    chartNoDataContainer.classList.remove('hidden');
    chartNoDataMessage.textContent = message || 'No data available.'; // Target the span
    if (sentimentChart) {
        sentimentChart.destroy();
        sentimentChart = null;
    }
    chartCanvas.classList.add('opacity-0', 'invisible');
}

function hideChartOverlays() {
    chartLoadingIndicator.classList.add('hidden');
    chartErrorContainer.classList.add('hidden');
    chartNoDataContainer.classList.add('hidden');
    chartCanvas.classList.remove('opacity-0', 'opacity-20', 'invisible'); // Remove all visibility/opacity classes
}

function showNewsLoading() {
    newsList.innerHTML = ''; // Clear previous content
    newsLoadingIndicator.classList.remove('hidden');
    noNewsMessage.classList.add('hidden');
    newsErrorMessage.classList.add('hidden');
}

function showNewsError(message) {
    newsList.innerHTML = '';
    newsLoadingIndicator.classList.add('hidden');
    noNewsMessage.classList.add('hidden');
    newsErrorMessage.classList.remove('hidden');
    newsErrorText.textContent = message || 'Error loading news articles.'; // Target the span
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
    prevDayButton.disabled = !isPresidentSelected;

    const today = dayjs().startOf('day');
    // Disable next if no president selected OR if current date is today or later
    const isNextDisabled = !isPresidentSelected || (currentDate && (currentDate.isSame(today, 'day') || currentDate.isAfter(today)));
    nextDayButton.disabled = isNextDisabled;

    // Toggle Tailwind classes for visual state
    prevDayButton.classList.toggle('opacity-50', prevDayButton.disabled);
    prevDayButton.classList.toggle('cursor-not-allowed', prevDayButton.disabled);
    nextDayButton.classList.toggle('opacity-50', nextDayButton.disabled);
    nextDayButton.classList.toggle('cursor-not-allowed', nextDayButton.disabled);
}


// --- Event Listeners ---

// Autocomplete search input listener
presidentSearchInput.addEventListener('input', (event) => {
    // Use debounce here if fetching directly on input becomes too frequent
    filterAndRenderPresidents(event.target.value);

    // If user clears input manually, reset everything related to the selection
     if (event.target.value.trim() === '' && selectedPresidentIdInput.value !== '') {
        clearPresidentSelection();
     }
});

// Prevent form submission if wrapped in a form, handle selection on Enter
presidentSearchInput.addEventListener('keydown', (event) => {
    const resultsItems = presidentResultsContainer.querySelectorAll('[role="option"]');
    const isResultsVisible = !presidentResultsContainer.classList.contains('hidden');

    if (!isResultsVisible || !resultsItems.length) {
        focusedResultIndex = -1; // Reset if no results or hidden
        if (event.key === 'Enter') event.preventDefault(); // Prevent submit even if no results shown
        return;
    }

    let newFocusIndex = focusedResultIndex;

    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            newFocusIndex = (focusedResultIndex + 1) % resultsItems.length;
            break;
        case 'ArrowUp':
            event.preventDefault();
             newFocusIndex = (focusedResultIndex - 1 + resultsItems.length) % resultsItems.length;
            break;
        case 'Enter':
             event.preventDefault();
             if (focusedResultIndex >= 0 && focusedResultIndex < resultsItems.length) {
                 const selectedItem = resultsItems[focusedResultIndex];
                 selectPresident(selectedItem.dataset.id, selectedItem.dataset.name);
             }
             // Don't change newFocusIndex, selection hides results anyway
             return; // Exit early after selection
         case 'Escape':
              event.preventDefault();
              hidePresidentResults();
              // Don't change newFocusIndex, results are hidden
              return; // Exit early
         case 'Tab':
             hidePresidentResults(); // Hide results on tab out
             // Don't change newFocusIndex
             return; // Allow default tab behavior
         default:
             // Don't change newFocusIndex for other keys
             return; // Exit early
    }

    // Update visual focus only if index changed
    if (newFocusIndex !== focusedResultIndex) {
        // Remove focus from old item
        if (focusedResultIndex >= 0) {
            resultsItems[focusedResultIndex]?.classList.remove('bg-slate-600');
        }
        // Add focus to new item
        resultsItems[newFocusIndex]?.classList.add('bg-slate-600');
        // Ensure the focused item is visible in the scrollable list
        resultsItems[newFocusIndex]?.scrollIntoView({ block: 'nearest' });

        focusedResultIndex = newFocusIndex; // Update the global index
    }
});


// Close results if clicking outside
document.addEventListener('click', (event) => {
    // Check if the click is outside the search input AND outside the results container
    if (!presidentSearchInput.contains(event.target) && !presidentResultsContainer.contains(event.target)) {
        hidePresidentResults();
    }
});


// News Pagination Listeners
prevDayButton.addEventListener('click', () => {
    const currentPresidentId = selectedPresidentIdInput.value;
    if (prevDayButton.disabled || !currentDate || !currentPresidentId) return;
    currentDate = currentDate.subtract(1, 'day');
    fetchNewsForDate(currentPresidentId);
    updatePaginationButtons(!!currentPresidentId); // Re-check buttons state
});

nextDayButton.addEventListener('click', () => {
    const currentPresidentId = selectedPresidentIdInput.value;
    if (nextDayButton.disabled || !currentDate || !currentPresidentId) return;
    currentDate = currentDate.add(1, 'day');
    fetchNewsForDate(currentPresidentId);
    updatePaginationButtons(!!currentPresidentId); // Re-check buttons state
});

// --- Initial Load ---

document.addEventListener('DOMContentLoaded', () => {
    // Set initial date
    currentDate = dayjs().startOf('day'); // Use today as the starting date
    currentDateSpan.textContent = currentDate.format('MMMM D, YYYY');

    if (initializeSupabase()) {
        fetchPresidents(); // Fetch presidents for the autocomplete

        // Initial state: No president selected
        showChartMessage('Please select a president to view the sentiment trend.');
        updatePaginationButtons(false); // Start with pagination disabled
        hideNewsMessages();
        noNewsMessage.classList.remove('hidden');
        noNewsText.textContent = "Select a president to view news.";
    } else {
        // UI disabling is handled within initializeSupabase/disableUIOnError
        console.warn("Supabase not initialized. Dashboard functionality limited.");
    }
});
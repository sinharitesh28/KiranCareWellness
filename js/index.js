// JavaScript for handling interactivity and dynamic content
document.addEventListener('DOMContentLoaded', () => {
    // Endpoint to fetch user details (name)
    const API_URL = '/auth/user-data';

    /**
     * Fetches the logged-in user's name from the server and updates the greeting.
     */
    async function fetchUser() {
        const greetingElement = document.getElementById('greeting');
        const defaultName = 'Ritesh'; // Personalized fallback name
        let userName = 'User';

        try {
            // Implement simple exponential backoff for resilience
            const maxRetries = 3;
            let response = null;
            
            for (let i = 0; i < maxRetries; i++) {
                try {
                    // Fetch is implicitly authenticated via the session cookie set by the server
                    response = await fetch(API_URL);
                    if (response.ok) break; // Break if successful

                    // Wait before retrying (1s, 2s, 4s)
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
                } catch (err) {
                    console.error('Fetch attempt failed:', err.message);
                    if (i === maxRetries - 1) throw err; // Throw on final attempt
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
                }
            }


            if (!response || !response.ok) {
                console.error('Failed to fetch user data after retries.');
                userName = defaultName;
            } else {
                const data = await response.json();
                // Assuming the server returns { name: "Ritesh" }
                if (data.name) {
                    userName = data.name;
                } else {
                    console.warn('User data response is missing the "name" field. Using default.');
                    userName = defaultName;
                }
            }
        } catch (error) {
            console.error('Fatal network error during user data fetch:', error);
            // On error, use the personalized default name
            userName = defaultName; 
        }

        // Update the greeting element with the fetched name
        // The text-quarterly class is used here for the userName for emphasis
        greetingElement.innerHTML = `Welcome, <span class="text-quarterly">${userName}</span>, to KiranCareWellness.`;
        
        // Animate its visibility (opacity-0 to opacity-100 is handled by Tailwind classes)
        greetingElement.classList.remove('opacity-0');
        greetingElement.classList.add('opacity-100');
    }

    fetchUser();
});
// server.js
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();
const cors = require('cors'); // <--- NEW: Import the cors middleware

const app = express();
const port = process.env.PORT || 3000;

// NEW: Configure CORS to allow requests from your local testing environment
// and your future live website domain.
// IMPORTANT: Replace 'https://www.your-existing-website.com' with your actual website's domain
// when you deploy your frontend. For now, 'http://localhost:8080' is for local testing.
app.use(cors({
  origin: ['http://localhost:8080', 'https://www.your-existing-website.com']
  // You can add more origins to this array if your website is hosted on multiple domains/subdomains.
  // For production, it's best to be as specific as possible rather than using '*'
}));

app.use(bodyParser.json());
// REMOVED: app.use(express.static('public')); // <--- This line is removed. The backend no longer serves static frontend files.

const ASSISTANT_ID = 'asst_IqchvEeXk7VtYNTkc4jMtNFz';

// In-memory storage for thread IDs. In a production app, you'd use a database.
const userThreads = {};

// Endpoint to handle chat requests from frontend
app.post('/chat', async (req, res) => {
    try {
        const { message, userId } = req.body; // userId is sent from the frontend

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        let threadId = userThreads[userId];

        // 1. Create a thread if one doesn't exist for the user
        if (!threadId) {
            const threadResponse = await axios.post('https://api.openai.com/v1/threads', {}, {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                    'OpenAI-Beta': 'assistants=v2' // Crucial header for Assistants API
                }
            });
            threadId = threadResponse.data.id;
            userThreads[userId] = threadId;
            console.log(`New thread created for user ${userId}: ${threadId}`);
        }

        // 2. Add the user's message to the thread
        await axios.post(`https://api.openai.com/v1/threads/${threadId}/messages`, {
            role: 'user',
            content: message
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v2'
            }
        });

        // 3. Run the assistant on the thread
        let runResponse = await axios.post(`https://api.openai.com/v1/threads/${threadId}/runs`, {
            assistant_id: ASSISTANT_ID
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v2'
            }
        });
        const runId = runResponse.data.id;

        // 4. Poll for the run completion
        let runStatus;
        do {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second
            const statusResponse = await axios.get(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'OpenAI-Beta': 'assistants=v2'
                }
            });
            runStatus = statusResponse.data.status;
            console.log(`Run status: ${runStatus}`);
        } while (runStatus !== 'completed' && runStatus !== 'failed' && runStatus !== 'cancelled' && runStatus !== 'expired'); // <--- NEW: Added 'expired' status

        if (runStatus === 'completed') {
            // 5. Retrieve messages from the thread
            // We fetch messages ordered by 'created_at' in descending order to easily get the latest.
            const messagesResponse = await axios.get(`https://api.openai.com/v1/threads/${threadId}/messages?order=desc`, {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'OpenAI-Beta': 'assistants=v2'
                }
            });

            // Find the last assistant message that was part of this specific run
            // This is important to ensure we're getting the response from the run we just initiated.
            const assistantMessages = messagesResponse.data.data.filter(
                msg => msg.role === 'assistant' && msg.run_id === runId
            );

            let reply = 'Sorry, no reply received from the assistant.';
            if (assistantMessages.length > 0) {
                const lastAssistantMessage = assistantMessages[0]; // Already sorted by desc created_at
                if (lastAssistantMessage.content && lastAssistantMessage.content.length > 0) {
                    // Find the first content block of type 'text'
                    const textContent = lastAssistantMessage.content.find(c => c.type === 'text');
                    if (textContent && textContent.text) {
                        reply = textContent.text.value;
                    }
                }
            }
            res.json({ reply, threadId });
        } else {
            res.status(500).json({ error: `Assistant run failed or incomplete with status: ${runStatus}` });
        }

    } catch (error) {
        console.error('Error in chat endpoint:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Something went wrong with the Assistant API interaction.' });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Chatbot API server running at http://localhost:${port}`);
});
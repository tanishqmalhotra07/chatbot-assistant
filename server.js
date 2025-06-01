// server.js
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static('public')); // Serve frontend files from 'public' folder

const ASSISTANT_ID = 'asst_IqchvEeXk7VtYNTkc4jMtNFz';

// In-memory storage for thread IDs. In a production app, you'd use a database.
const userThreads = {};

// Endpoint to handle chat requests from frontend
app.post('/chat', async (req, res) => {
    try {
        const { message, userId } = req.body; // Assuming you'll send a userId from the frontend

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
        } while (runStatus !== 'completed' && runStatus !== 'failed' && runStatus !== 'cancelled');

        if (runStatus === 'completed') {
            // 5. Retrieve messages from the thread
            const messagesResponse = await axios.get(`https://api.openai.com/v1/threads/${threadId}/messages`, {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'OpenAI-Beta': 'assistants=v2'
                }
            });

            // Find the last assistant message
            const assistantMessages = messagesResponse.data.data.filter(
                msg => msg.role === 'assistant'
            ).sort((a, b) => b.created_at - a.created_at); // Sort by created_at descending

            let reply = 'Sorry, no reply received from the assistant.';
            if (assistantMessages.length > 0) {
                // Assuming the last message from the assistant contains the relevant response
                const lastAssistantMessage = assistantMessages[0];
                if (lastAssistantMessage.content && lastAssistantMessage.content.length > 0) {
                    // Check if content is an array and has text
                    const textContent = lastAssistantMessage.content.find(c => c.type === 'text');
                    if (textContent && textContent.text) {
                        reply = textContent.text.value;
                    }
                }
            }
            res.json({ reply, threadId });
        } else {
            res.status(500).json({ error: `Assistant run failed with status: ${runStatus}` });
        }

    } catch (error) {
        console.error('Error in chat endpoint:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Something went wrong with the Assistant API interaction.' });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Chatbot server running at http://localhost:${port}`);
});
const { Message } = require('./database');
const logger = require('./logger');

/**
 * Send a message to a client about a transaction
 * @param {Object} options - Message options
 * @param {number} options.clientId - Client ID
 * @param {number} options.transactionId - Transaction ID (optional)
 * @param {string} options.transactionType - 'deposit' or 'withdrawal'
 * @param {number} options.amount - Transaction amount
 * @param {string} options.clientName - Client name
 * @param {string} options.phoneNumber - Client phone number
 * @param {number} options.balance - Current balance after transaction
 * @param {string} options.date - Transaction date
 * @returns {Promise<Object>} Created message record
 */
async function sendTransactionMessage(options) {
    const {
        clientId,
        transactionId,
        transactionType,
        amount,
        clientName,
        phoneNumber,
        balance,
        date
    } = options;

    // Format amount with currency symbol
    const formattedAmount = `₵${parseFloat(amount).toFixed(2)}`;
    const formattedBalance = `₵${parseFloat(balance).toFixed(2)}`;
    
    // Format date for display
    const transactionDate = new Date(date).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });

    let messageText;
    if (transactionType === 'deposit') {
        messageText = `Hello ${clientName}, your deposit of ${formattedAmount} has been successfully processed on ${transactionDate}. Your current balance is ${formattedBalance}. Thank you for your business!`;
    } else if (transactionType === 'withdrawal') {
        messageText = `Hello ${clientName}, your withdrawal of ${formattedAmount} has been successfully processed on ${transactionDate}. Your current balance is ${formattedBalance}. Thank you for your business!`;
    } else {
        messageText = `Hello ${clientName}, a transaction of ${formattedAmount} has been processed on ${transactionDate}. Your current balance is ${formattedBalance}.`;
    }

    try {
        // Create message record in database
        const message = await Message.create({
            client_id: clientId,
            transaction_id: transactionId || null,
            message_type: 'transaction',
            message: messageText,
            phone_number: phoneNumber,
            status: 'pending'
        });

        const sendResult = await sendSMSWithDetails(phoneNumber, messageText);
        const providerMessageId = extractArkeselMessageId(sendResult.data);
        await Message.updateStatus(message.id, sendResult.success ? 'sent' : 'failed', {
            providerMessageId,
            providerResponse: sendResult,
            sentAt: sendResult.success ? new Date().toISOString() : null,
            failedAt: sendResult.success ? null : new Date().toISOString()
        });
        
        console.log(`Message queued for client ${clientId} (${phoneNumber}): ${messageText.substring(0, 50)}...`);
        
        return message;
    } catch (error) {
        console.error('Error sending transaction message:', error);
        // Don't throw - messaging failure shouldn't break the transaction
        return null;
    }
}

/**
 * Send a welcome message to a new client when their account is created
 * @param {Object} options - Message options
 * @param {number} options.clientId - Client ID
 * @param {string} options.clientName - Client name
 * @param {string} options.phoneNumber - Client phone number
 * @param {number} options.rate - Client's rate (savings amount)
 * @returns {Promise<Object>} Created message record
 */
async function sendWelcomeMessage(options) {
    const {
        clientId,
        clientName,
        phoneNumber,
        rate
    } = options;

    // Format rate with currency symbol
    const formattedRate = `₵${parseFloat(rate).toFixed(2)}`;
    
    // Format date for display
    const today = new Date().toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });

    const messageText = `Hello ${clientName}, welcome to Lucky Susu! Your account has been successfully created on ${today}. Your savings rate is ${formattedRate} per deposit. We're excited to help you reach your financial goals. Thank you for choosing us!`;

    try {
        // Create message record in database
        const message = await Message.create({
            client_id: clientId,
            transaction_id: null,
            message_type: 'welcome',
            message: messageText,
            phone_number: phoneNumber,
            status: 'pending'
        });

        const sendResult = await sendSMSWithDetails(phoneNumber, messageText);
        const providerMessageId = extractArkeselMessageId(sendResult.data);
        await Message.updateStatus(message.id, sendResult.success ? 'sent' : 'failed', {
            providerMessageId,
            providerResponse: sendResult,
            sentAt: sendResult.success ? new Date().toISOString() : null,
            failedAt: sendResult.success ? null : new Date().toISOString()
        });
        
        console.log(`Welcome message queued for client ${clientId} (${phoneNumber}): ${messageText.substring(0, 50)}...`);
        
        return message;
    } catch (error) {
        console.error('Error sending welcome message:', error);
        // Don't throw - messaging failure shouldn't break account creation
        return null;
    }
}

/**
 * Send SMS using an external service (placeholder for integration)
 * @param {string} phoneNumber - Phone number to send to
 * @param {string} message - Message text
 * @returns {Promise<boolean>} Success status
 */
async function sendSMS(phoneNumber, message) {
    const result = await sendSMSWithDetails(phoneNumber, message);
    return result.success;
}

/**
 * Send SMS and return provider response details
 * @param {string} phoneNumber - Phone number to send to
 * @param {string} message - Message text
 * @returns {Promise<{success: boolean, status?: number, data?: any, error?: string}>}
 */
async function sendSMSWithDetails(phoneNumber, message) {
    const apiKey = process.env.SYSTEM_API_KEY;
    const smsApiUrl = process.env.SMS_API_URL || 'https://sms.arkesel.com/api/v2/sms/send';
    const senderId = process.env.SMS_SENDER_ID || 'LuckySusu';

    if (!apiKey || !smsApiUrl) {
        logger.warn('SMS provider configuration missing', {
            hasApiKey: !!apiKey,
            hasApiUrl: !!smsApiUrl
        });
        return {
            success: false,
            error: 'Missing SMS provider configuration'
        };
    }

    try {
        const normalizedRecipient = normalizeGhanaNumber(phoneNumber);

        const response = await fetch(smsApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': apiKey
            },
            body: JSON.stringify({
                sender: senderId,
                message,
                recipients: [normalizedRecipient]
            })
        });

        const responseText = await response.text();
        let parsedData = responseText;
        try {
            parsedData = responseText ? JSON.parse(responseText) : null;
        } catch (parseError) {
            // Keep raw response text when provider does not return JSON
        }

        if (!response.ok) {
            logger.error('SMS provider request failed', {
                status: response.status,
                statusText: response.statusText,
                body: parsedData
            });
            return {
                success: false,
                status: response.status,
                data: parsedData,
                error: response.statusText
            };
        }

        return {
            success: true,
            status: response.status,
            data: parsedData
        };
    } catch (error) {
        logger.error('SMS provider call failed', {
            error: error.message
        });
        return {
            success: false,
            error: error.message
        };
    }
}

function normalizeGhanaNumber(phoneNumber) {
    const digits = String(phoneNumber || '').replace(/\D/g, '');
    if (digits.startsWith('233') && digits.length === 12) {
        return digits;
    }
    if (digits.startsWith('0') && digits.length === 10) {
        return `233${digits.slice(1)}`;
    }
    return digits;
}

function extractArkeselMessageId(providerData) {
    if (!providerData || typeof providerData !== 'object') {
        return null;
    }
    const firstRecord = Array.isArray(providerData.data) ? providerData.data[0] : null;
    return firstRecord?.id || providerData.id || null;
}

module.exports = {
    sendTransactionMessage,
    sendWelcomeMessage,
    sendSMS,
    sendSMSWithDetails
};


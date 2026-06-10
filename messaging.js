const { Message, Transaction, User } = require('./database');
const logger = require('./logger');

function formatDisplayDate(date) {
    return new Date(date).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}

async function deliverMessageRecord(messageData) {
    const message = await Message.create({
        ...messageData,
        status: 'pending'
    });

    const sendResult = await sendSMSWithDetails(messageData.phone_number, messageData.message);
    const providerMessageId = extractArkeselMessageId(sendResult.data);
    await Message.updateStatus(message.id, sendResult.success ? 'sent' : 'failed', {
        providerMessageId,
        providerResponse: sendResult,
        sentAt: sendResult.success ? new Date().toISOString() : null,
        failedAt: sendResult.success ? null : new Date().toISOString()
    });

    return { message, sendResult };
}

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
        const { message } = await deliverMessageRecord({
            client_id: clientId,
            transaction_id: transactionId || null,
            message_type: 'transaction',
            message: messageText,
            phone_number: phoneNumber
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
        const { message } = await deliverMessageRecord({
            client_id: clientId,
            transaction_id: null,
            message_type: 'welcome',
            message: messageText,
            phone_number: phoneNumber
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

/**
 * Notify clients and agent when admin approves daily deposits
 */
async function sendDepositApprovalNotifications(agentId, date) {
    const deposits = await Transaction.getAgentDepositsForDate(agentId, date);
    const displayDate = formatDisplayDate(date);
    const result = {
        clients_notified: 0,
        clients_failed: 0,
        agent_notified: false,
        total_deposits: deposits.length
    };

    for (const deposit of deposits) {
        if (!deposit.client_phone) {
            result.clients_failed += 1;
            continue;
        }

        const formattedAmount = `₵${parseFloat(deposit.amount).toFixed(2)}`;
        const formattedBalance = `₵${parseFloat(deposit.current_balance).toFixed(2)}`;
        const messageText = `Hello ${deposit.client_name}, your deposit of ${formattedAmount} for ${displayDate} has been confirmed by Lucky Susu. Your current balance is ${formattedBalance}. Thank you for saving with us!`;

        try {
            const { sendResult } = await deliverMessageRecord({
                client_id: deposit.client_id,
                transaction_id: deposit.id,
                message_type: 'deposit_approval',
                message: messageText,
                phone_number: deposit.client_phone
            });
            if (sendResult.success) {
                result.clients_notified += 1;
            } else {
                result.clients_failed += 1;
            }
        } catch (error) {
            logger.error('Failed to send deposit approval SMS', {
                error: error.message,
                clientId: deposit.client_id,
                transactionId: deposit.id
            });
            result.clients_failed += 1;
        }
    }

    try {
        const agent = await User.getById(agentId);
        if (agent?.contact) {
            const totalAmount = deposits.reduce((sum, row) => sum + (parseFloat(row.amount) || 0), 0);
            const formattedTotal = `₵${totalAmount.toFixed(2)}`;
            const agentMessage = `Hello ${agent.name}, your daily deposits for ${displayDate} (${deposits.length} deposit(s), total ${formattedTotal}) have been approved by Lucky Susu admin.`;
            const sendResult = await sendSMSWithDetails(agent.contact, agentMessage);
            result.agent_notified = sendResult.success;
        }
    } catch (error) {
        logger.error('Failed to send agent deposit approval SMS', {
            error: error.message,
            agentId
        });
    }

    return result;
}

/**
 * Notify agent when admin rejects daily deposits
 */
async function sendDepositRejectionNotification(agentId, date, note) {
    const agent = await User.getById(agentId);
    if (!agent?.contact) {
        return { agent_notified: false };
    }

    const displayDate = formatDisplayDate(date);
    let messageText = `Hello ${agent.name}, your daily deposits for ${displayDate} were rejected by Lucky Susu admin. Recorded deposits for that day have been removed.`;
    if (note) {
        messageText += ` Reason: ${note}`;
    }

    const sendResult = await sendSMSWithDetails(agent.contact, messageText);
    return { agent_notified: sendResult.success };
}

function buildApprovalNotificationMessage(summary) {
    const parts = [`Deposits approved for ${summary.total_deposits} client(s).`];
    if (summary.clients_notified > 0) {
        parts.push(`${summary.clients_notified} SMS confirmation(s) sent.`);
    }
    if (summary.agent_notified) {
        parts.push('Agent notified.');
    }
    if (summary.clients_failed > 0) {
        parts.push(`${summary.clients_failed} SMS could not be sent.`);
    }
    return parts.join(' ');
}

function buildRejectionNotificationMessage(summary) {
    return summary.agent_notified
        ? 'Deposits rejected and removed. Agent notified via SMS.'
        : 'Deposits rejected and removed for this day.';
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
    sendDepositApprovalNotifications,
    sendDepositRejectionNotification,
    buildApprovalNotificationMessage,
    buildRejectionNotificationMessage,
    sendSMS,
    sendSMSWithDetails
};


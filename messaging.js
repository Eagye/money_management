const { Message } = require('./database');

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

        // In a production environment, you would integrate with an SMS service here
        // For now, we'll mark it as sent (you can integrate with services like Twilio, AWS SNS, etc.)
        // Example integration:
        // await sendSMS(phoneNumber, messageText);
        
        // For now, we'll simulate sending and mark as sent
        // TODO: Integrate with actual SMS service provider
        await Message.updateStatus(message.id, 'sent');
        
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

        // In a production environment, you would integrate with an SMS service here
        // For now, we'll simulate sending and mark as sent
        // TODO: Integrate with actual SMS service provider
        await Message.updateStatus(message.id, 'sent');
        
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
    // TODO: Integrate with SMS service provider
    // Examples:
    // - Twilio: https://www.twilio.com/docs/sms
    // - AWS SNS: https://aws.amazon.com/sns/
    // - Local SMS gateway
    
    // Placeholder implementation
    console.log(`[SMS] To: ${phoneNumber}`);
    console.log(`[SMS] Message: ${message}`);
    
    // Return true to simulate success
    // In production, replace this with actual SMS API call
    return true;
}

module.exports = {
    sendTransactionMessage,
    sendWelcomeMessage,
    sendSMS
};


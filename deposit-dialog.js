// Deposit Dialog Component
class DepositDialog {
    // Check if date is a weekend (Saturday = 6, Sunday = 0)
    static isWeekend(dateString) {
        const date = new Date(dateString);
        const dayOfWeek = date.getDay();
        return dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
    }

    static show(clientId, clientRate, clientName) {
        // Check if today is a weekend before opening dialog
        const today = new Date().toISOString().split('T')[0];
        if (DepositDialog.isWeekend(today)) {
            const dayName = new Date(today).toLocaleDateString('en-US', { weekday: 'long' });
            if (typeof Dialog !== 'undefined') {
                Dialog.error(
                    `Deposits cannot be added on weekends. Today is ${dayName}. Please try again on a weekday (Monday - Friday).`,
                    'Weekend Restriction'
                );
            } else {
                alert(`Deposits cannot be added on weekends. Today is ${dayName}. Please try again on a weekday (Monday - Friday).`);
            }
            return;
        }

        // Remove existing dialog if any
        const existingDialog = document.querySelector('.dialog-overlay');
        if (existingDialog) {
            existingDialog.remove();
        }

        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';
        overlay.id = 'depositDialogOverlay';

        // Create dialog box
        const dialogBox = document.createElement('div');
        dialogBox.className = 'dialog-box';
        dialogBox.style.maxWidth = '450px';

        // Create dialog HTML with form
        dialogBox.innerHTML = `
            <div class="dialog-header">
                <div class="dialog-icon info">
                    ₵
                </div>
                <h3 class="dialog-title">Add Deposit</h3>
            </div>
            <div class="dialog-body">
                <div style="margin-bottom: 16px;">
                    <strong>Client:</strong> ${clientName}<br>
                    <strong>Rate:</strong> ₵${parseFloat(clientRate).toFixed(2)}
                </div>
                <form id="depositForm" autocomplete="off">
                    <div class="form-group" style="margin-bottom: 16px;">
                        <label for="depositAmount" class="form-label" style="display: block; margin-bottom: 8px; font-weight: 600; font-size: 13px;">Amount (₵) *</label>
                        <input type="number" id="depositAmount" class="form-input" placeholder="Enter amount" step="0.01" min="0" autocomplete="off" required style="width: 100%; padding: 10px 12px; border: 2px solid var(--border-color); border-radius: 6px; font-size: 13px;">
                        <div id="amountError" style="color: var(--danger-color); font-size: 11px; margin-top: 4px; display: none;"></div>
                        <div id="amountHint" style="color: var(--text-secondary); font-size: 11px; margin-top: 4px;">
                            Amount must be a multiple of ₵${parseFloat(clientRate).toFixed(2)}
                        </div>
                    </div>
                    <div class="form-group" style="margin-bottom: 16px;">
                        <label for="depositNotes" class="form-label" style="display: block; margin-bottom: 8px; font-weight: 600; font-size: 13px;">Notes (Optional)</label>
                        <textarea id="depositNotes" class="form-input" rows="3" placeholder="Add any notes..." autocomplete="off" style="width: 100%; padding: 10px 12px; border: 2px solid var(--border-color); border-radius: 6px; font-size: 13px; resize: vertical;"></textarea>
                    </div>
                </form>
            </div>
            <div class="dialog-footer">
                <button class="dialog-btn dialog-btn-secondary" id="depositCancel">Cancel</button>
                <button class="dialog-btn dialog-btn-primary" id="depositSubmit">Add Deposit</button>
            </div>
        `;

        overlay.appendChild(dialogBox);
        document.body.appendChild(overlay);

        // Show dialog with animation
        setTimeout(() => {
            overlay.classList.add('show');
        }, 10);

        // Amount validation
        const amountInput = document.getElementById('depositAmount');
        const amountError = document.getElementById('amountError');
        const rate = parseFloat(clientRate);

        amountInput.addEventListener('input', function() {
            const amount = parseFloat(this.value);
            amountError.style.display = 'none';
            amountInput.style.borderColor = 'var(--border-color)';

            if (this.value && !isNaN(amount) && amount > 0) {
                const remainder = amount % rate;
                const tolerance = 0.01; // For floating point precision

                if (remainder > tolerance && (rate - remainder) > tolerance) {
                    amountError.textContent = `Amount must be a multiple of ₵${rate.toFixed(2)}. Example: ₵${rate.toFixed(2)}, ₵${(rate * 2).toFixed(2)}, ₵${(rate * 3).toFixed(2)}`;
                    amountError.style.display = 'block';
                    amountInput.style.borderColor = 'var(--danger-color)';
                } else {
                    amountInput.style.borderColor = 'var(--success-color)';
                }
            }
        });

        // Handle cancel
        document.getElementById('depositCancel').addEventListener('click', () => {
            DepositDialog.close();
        });

        // Handle overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                DepositDialog.close();
            }
        });

        // Handle submit
        document.getElementById('depositSubmit').addEventListener('click', async () => {
            const amount = parseFloat(amountInput.value);
            // Automatically use today's date
            const today = new Date().toISOString().split('T')[0];
            const notes = document.getElementById('depositNotes').value.trim();

            // Double-check if today is a weekend (in case date changed while dialog was open)
            if (DepositDialog.isWeekend(today)) {
                const dayName = new Date(today).toLocaleDateString('en-US', { weekday: 'long' });
                Dialog.error(`Deposits cannot be added on weekends. Today is ${dayName}. Please try again on a weekday (Monday - Friday).`, 'Weekend Restriction');
                return;
            }

            // Validate amount
            if (!amount || isNaN(amount) || amount <= 0) {
                amountError.textContent = 'Please enter a valid amount';
                amountError.style.display = 'block';
                amountInput.style.borderColor = 'var(--danger-color)';
                amountInput.focus();
                return;
            }

            // Check if amount is multiple of rate
            const remainder = amount % rate;
            const tolerance = 0.01;
            if (remainder > tolerance && (rate - remainder) > tolerance) {
                amountError.textContent = `Amount must be an exact multiple of ₵${rate.toFixed(2)}`;
                amountError.style.display = 'block';
                amountInput.style.borderColor = 'var(--danger-color)';
                amountInput.focus();
                return;
            }

            // Submit deposit
            const submitBtn = document.getElementById('depositSubmit');
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Processing...';

            try {
                const response = await TransactionAPI.create({
                    client_id: clientId,
                    amount: amount,
                    transaction_type: 'deposit',
                    transaction_date: today, // Automatically use today's date
                    notes: notes || null
                });

                if (response.success) {
                    // Clear form
                    document.getElementById('depositForm').reset();
                    amountInput.value = '';
                    document.getElementById('depositNotes').value = '';
                    amountInput.classList.remove('invalid', 'valid');
                    amountInput.style.borderColor = 'var(--border-color)';
                    amountError.style.display = 'none';
                    
                    DepositDialog.close();
                    Dialog.success('Deposit added successfully!', 'Success');
                    // Refresh clients list
                    if (typeof window.refreshClients === 'function') {
                        await window.refreshClients();
                    } else if (typeof window.loadClients === 'function') {
                        await window.loadClients();
                    } else {
                        // Fallback: reload page
                        setTimeout(() => {
                            window.location.reload();
                        }, 1000);
                    }
                }
            } catch (error) {
                Dialog.error(error.message || 'Failed to add deposit. Please try again.', 'Error');
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        });

        // Close on Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                DepositDialog.close();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);

        // Focus on amount input
        setTimeout(() => {
            amountInput.focus();
        }, 100);
    }

    static close() {
        const overlay = document.getElementById('depositDialogOverlay');
        if (overlay) {
            overlay.classList.remove('show');
            setTimeout(() => {
                overlay.remove();
            }, 300);
        }
    }
}

// Make DepositDialog available globally
if (typeof window !== 'undefined') {
    window.DepositDialog = DepositDialog;
}


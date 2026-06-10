// View Client Dialog Component
class ViewClientDialog {
    static async show(clientId) {
        console.log('ViewClientDialog.show called with clientId:', clientId);
        
        if (!clientId) {
            console.error('No client ID provided');
            if (typeof Dialog !== 'undefined') {
                Dialog.error('Client ID is required', 'Error');
            }
            return;
        }

        try {
            // Check if ClientAPI is available
            if (typeof ClientAPI === 'undefined') {
                console.error('ClientAPI is not defined');
                if (typeof Dialog !== 'undefined') {
                    Dialog.error('API client not loaded. Please refresh the page.', 'Error');
                } else {
                    alert('API client not loaded. Please refresh the page.');
                }
                return;
            }

            // Get client data
            console.log('Fetching client data for ID:', clientId);
            const response = await ClientAPI.getById(clientId);
            console.log('Client API response:', response);
            
            if (!response || !response.success || !response.data) {
                console.error('Invalid response:', response);
                if (typeof Dialog !== 'undefined') {
                    Dialog.error('Failed to load client information', 'Error');
                } else {
                    alert('Failed to load client information');
                }
                return;
            }

            const client = response.data;

            // Remove existing dialog if any
            const existingDialog = document.querySelector('.dialog-overlay');
            if (existingDialog) {
                existingDialog.remove();
            }

            // Create overlay
            const overlay = document.createElement('div');
            overlay.className = 'dialog-overlay';
            overlay.id = 'viewClientDialogOverlay';

            // Create dialog box
            const dialogBox = document.createElement('div');
            dialogBox.className = 'dialog-box';
            dialogBox.style.maxWidth = '500px';

            // Format phone number
            const formatPhone = (phone) => {
                const digits = phone.replace(/\D/g, '');
                if (digits.length === 10) {
                    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
                }
                return phone;
            };

            // Format currency
            const formatCurrency = (amount) => {
                return `₵${parseFloat(amount || 0).toFixed(2)}`;
            };

            // Format date
            const formatDate = (dateString) => {
                if (!dateString) return 'N/A';
                const date = new Date(dateString);
                return date.toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                });
            };

            // Create dialog HTML
            dialogBox.innerHTML = `
                <div class="dialog-header">
                    <div class="dialog-icon info">
                        👤
                    </div>
                    <h3 class="dialog-title">Client Details</h3>
                </div>
                <div class="dialog-body" style="max-height: 500px; overflow-y: auto;">
                    <div style="margin-bottom: 20px;">
                        <h4 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 700; color: var(--text-primary);">${client.name}</h4>
                    </div>
                    
                    <div style="display: grid; gap: 16px;">
                        <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border: 1px solid var(--border-color);">
                            <div style="font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Phone Number</div>
                            <div style="font-size: 15px; font-weight: 600; color: var(--text-primary);">${formatPhone(client.phone)}</div>
                        </div>

                        <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border: 1px solid var(--border-color);">
                            <div style="font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Gender</div>
                            <div style="font-size: 15px; font-weight: 600; color: var(--text-primary);">${client.gender}</div>
                        </div>

                        <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border: 1px solid var(--border-color);">
                            <div style="font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Box Rate</div>
                            <div style="font-size: 15px; font-weight: 600; color: var(--text-primary);">${formatCurrency(client.rate)}</div>
                        </div>

                        <div id="boxAccountInfo" style="padding: 16px; background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 8px; border: 2px solid #fbbf24;">
                            <div style="font-size: 12px; font-weight: 700; color: #92400e; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;">Box Account</div>
                            <div id="boxAccountDetails" style="font-size: 13px; color: #78350f;">Loading box account...</div>
                            <div id="deferralAdminControls" style="display:none; margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(146, 64, 14, 0.2);"></div>
                        </div>

                        <div style="padding: 12px; background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%); border-radius: 8px; border: 2px solid #86efac;">
                            <div style="font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Current Balance</div>
                            <div style="font-size: 20px; font-weight: 800; color: var(--success-color);">${formatCurrency(client.current_balance)}</div>
                        </div>

                        <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border: 1px solid var(--border-color);">
                            <div style="font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Agent Assigned</div>
                            <div style="font-size: 15px; font-weight: 600; color: var(--text-primary);" id="viewDialogAgentName">Agent</div>
                        </div>

                        <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border: 1px solid var(--border-color);">
                            <div style="font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Registered Date</div>
                            <div style="font-size: 13px; font-weight: 500; color: var(--text-primary);">${formatDate(client.created_at)}</div>
                        </div>
                    </div>

                </div>
                <div class="dialog-footer">
                    <button class="dialog-btn dialog-btn-primary" id="viewClientClose">Close</button>
                </div>
            `;

            overlay.appendChild(dialogBox);
            document.body.appendChild(overlay);

            // Show dialog with animation
            setTimeout(() => {
                overlay.classList.add('show');
            }, 10);

            // Handle close
            const closeBtn = document.getElementById('viewClientClose');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    ViewClientDialog.close();
                });
            }

            // Handle overlay click
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    ViewClientDialog.close();
                }
            });

            // Close on Escape key
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    ViewClientDialog.close();
                    document.removeEventListener('keydown', handleEscape);
                }
            };
            document.addEventListener('keydown', handleEscape);

            // Load and display agent name after dialog is in DOM
            setTimeout(() => {
                try {
                    const userData = localStorage.getItem('user');
                    if (userData) {
                        const user = JSON.parse(userData);
                        const agentNameElement = document.getElementById('viewDialogAgentName');
                        if (agentNameElement && user.name) {
                            agentNameElement.textContent = user.name;
                        } else if (agentNameElement) {
                            agentNameElement.textContent = 'Agent';
                        }
                    } else {
                        const agentNameElement = document.getElementById('viewDialogAgentName');
                        if (agentNameElement) {
                            agentNameElement.textContent = 'Guest';
                        }
                    }
                } catch (error) {
                    console.error('Error loading agent name:', error);
                    const agentNameElement = document.getElementById('viewDialogAgentName');
                    if (agentNameElement) {
                        agentNameElement.textContent = 'Agent';
                    }
                }
            }, 50);

            if (typeof ClientAPI !== 'undefined' && ClientAPI.getBoxAccount) {
                ClientAPI.getBoxAccount(clientId)
                    .then((boxResponse) => {
                        const detailsElement = document.getElementById('boxAccountDetails');
                        if (!detailsElement || !boxResponse?.success || !boxResponse.data) {
                            return;
                        }
                        const account = boxResponse.data;
                        const ledger = account.ledger || {};
                        detailsElement.innerHTML = `
                            <div><strong>Active boxes:</strong> ${ledger.active_boxes || 0}</div>
                            <div style="margin-top: 6px;"><strong>Pages:</strong> ${ledger.full_pages || 0} full, ${ledger.partial_boxes || 0} partial (of 31)</div>
                            <div style="margin-top: 6px;"><strong>Max payout:</strong> ${formatCurrency(account.max_payout || 0)}</div>
                            <div style="margin-top: 6px;"><strong>Deferral:</strong> ${account.deferral_active ? 'Active' : 'Off'}</div>
                        `;

                        const userData = localStorage.getItem('user');
                        let isAdmin = false;
                        try {
                            isAdmin = userData ? JSON.parse(userData).isAdmin === true : false;
                        } catch (e) {
                            isAdmin = false;
                        }

                        const deferralControls = document.getElementById('deferralAdminControls');
                        if (deferralControls && isAdmin && typeof AdminAPI !== 'undefined' && AdminAPI.setDeferral) {
                            deferralControls.style.display = 'block';
                            deferralControls.innerHTML = `
                                <label style="display:flex; align-items:center; gap:8px; font-size:13px; color:#78350f; cursor:pointer;">
                                    <input type="checkbox" id="deferralToggle" ${account.deferral_active ? 'checked' : ''} />
                                    Deferral request approved (skip commission on incomplete page)
                                </label>
                            `;
                            const toggle = document.getElementById('deferralToggle');
                            if (toggle) {
                                toggle.addEventListener('change', async function() {
                                    try {
                                        const response = await AdminAPI.setDeferral(clientId, client.agent_id, this.checked);
                                        if (!response?.success) {
                                            throw new Error(response?.error || 'Failed to update deferral');
                                        }
                                        if (typeof Toast !== 'undefined') {
                                            Toast.success(this.checked ? 'Deferral enabled for this client.' : 'Deferral disabled for this client.');
                                        }
                                    } catch (error) {
                                        this.checked = !this.checked;
                                        if (typeof Dialog !== 'undefined') {
                                            Dialog.error(error.message || 'Failed to update deferral', 'Error');
                                        } else {
                                            alert(error.message || 'Failed to update deferral');
                                        }
                                    }
                                });
                            }
                        }
                    })
                    .catch((error) => {
                        console.error('Error loading box account:', error);
                        const detailsElement = document.getElementById('boxAccountDetails');
                        if (detailsElement) {
                            detailsElement.textContent = 'Unable to load box account information.';
                        }
                    });
            }

            console.log('View client dialog created and shown');

        } catch (error) {
            console.error('Error loading client:', error);
            Dialog.error('Failed to load client information. Please try again.', 'Error');
        }
    }

    static close() {
        const overlay = document.getElementById('viewClientDialogOverlay');
        if (overlay) {
            overlay.classList.remove('show');
            setTimeout(() => {
                overlay.remove();
            }, 300);
        }
    }
}

// Make ViewClientDialog available globally
if (typeof window !== 'undefined') {
    window.ViewClientDialog = ViewClientDialog;
}


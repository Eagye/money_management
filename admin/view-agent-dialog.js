// View Agent Dialog Component
class ViewAgentDialog {
    static async show(agent) {
        console.log('ViewAgentDialog.show called with agent:', agent);
        
        if (!agent || !agent.id) {
            console.error('No agent ID provided');
            if (typeof Dialog !== 'undefined') {
                Dialog.error('Agent information is required', 'Error');
            }
            return;
        }

        try {
            // Check if AdminAPI is available
            if (typeof AdminAPI === 'undefined') {
                console.error('AdminAPI is not defined');
                if (typeof Dialog !== 'undefined') {
                    Dialog.error('API client not loaded. Please refresh the page.', 'Error');
                } else {
                    alert('API client not loaded. Please refresh the page.');
                }
                return;
            }

            // Get agent statistics
            console.log('Fetching agent statistics for ID:', agent.id);
            let stats = {
                total_clients: 0,
                male_count: 0,
                female_count: 0,
                other_count: 0,
                total_balance: 0
            };

            try {
                const statsResponse = await AdminAPI.getAgentStats(agent.id);
                if (statsResponse && statsResponse.success) {
                    stats = statsResponse.data;
                }
            } catch (statsError) {
                console.warn('Could not fetch agent statistics:', statsError);
                // Continue with default stats
            }

            // Remove existing dialog if any
            const existingDialog = document.querySelector('.dialog-overlay');
            if (existingDialog) {
                existingDialog.remove();
            }

            // Create overlay
            const overlay = document.createElement('div');
            overlay.className = 'dialog-overlay';
            overlay.id = 'agentDialogOverlay';

            // Format date
            function formatDate(dateString) {
                if (!dateString) return '--';
                const date = new Date(dateString);
                return date.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }

            // Format currency
            function formatCurrency(amount) {
                return new Intl.NumberFormat('en-GH', {
                    style: 'currency',
                    currency: 'GHS',
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }).format(amount || 0);
            }

            // Create dialog content
            const dialog = document.createElement('div');
            dialog.className = 'dialog-box';
            dialog.id = 'agentDialog';
            dialog.style.maxWidth = '520px';
            dialog.style.maxHeight = '85vh';
            dialog.style.overflowY = 'auto';
            
            // Add custom styles for compact dialog
            const dialogStyle = document.createElement('style');
            dialogStyle.id = 'agentDialogCustomStyles';
            dialogStyle.textContent = `
                #agentDialog .dialog-header {
                    padding: 12px 16px;
                }
                #agentDialog .dialog-title {
                    font-size: 16px;
                }
                #agentDialog .dialog-icon {
                    width: 32px;
                    height: 32px;
                    font-size: 16px;
                }
                #agentDialog .dialog-footer {
                    padding: 12px 16px;
                }
                #agentDialog .dialog-btn {
                    padding: 8px 16px;
                    font-size: 12px;
                }
            `;
            document.head.appendChild(dialogStyle);

            dialog.innerHTML = `
                <div class="dialog-header">
                    <div class="dialog-icon info">👤</div>
                    <h3 class="dialog-title">Agent Details</h3>
                </div>
                <div class="dialog-body" style="max-height: 500px; overflow-y: auto; padding: 16px;">
                <div style="display: grid; gap: 12px;">
                    <!-- Personal Information -->
                    <div style="background: var(--background); padding: 12px; border-radius: 6px; border: 1px solid var(--border-color);">
                        <h4 style="margin: 0 0 10px 0; font-size: 13px; font-weight: 600; color: var(--text-primary); border-bottom: 1px solid var(--border-color); padding-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Personal Information</h4>
                        <div style="display: grid; gap: 8px;">
                            <div style="display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px;">
                                <span style="color: var(--text-secondary); font-weight: 500;">Name:</span>
                                <span style="color: var(--text-primary); font-weight: 500;">${agent.name || 'N/A'}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; padding: 4px 0; border-top: 1px solid var(--border-color); font-size: 12px;">
                                <span style="color: var(--text-secondary); font-weight: 500;">Email:</span>
                                <span style="color: var(--text-primary); font-weight: 500;">${agent.email || 'N/A'}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; padding: 4px 0; border-top: 1px solid var(--border-color); font-size: 12px;">
                                <span style="color: var(--text-secondary); font-weight: 500;">Contact:</span>
                                <span style="color: var(--text-primary); font-weight: 500;">${agent.contact || 'N/A'}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; padding: 4px 0; border-top: 1px solid var(--border-color); font-size: 12px;">
                                <span style="color: var(--text-secondary); font-weight: 500;">Registered:</span>
                                <span style="color: var(--text-primary); font-weight: 500;">${formatDate(agent.created_at)}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Guarantor Information -->
                    <div style="background: var(--background); padding: 12px; border-radius: 6px; border: 1px solid var(--border-color);">
                        <h4 style="margin: 0 0 10px 0; font-size: 13px; font-weight: 600; color: var(--text-primary); border-bottom: 1px solid var(--border-color); padding-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Guarantor Information</h4>
                        <div style="display: grid; gap: 8px;">
                            <div style="display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px;">
                                <span style="color: var(--text-secondary); font-weight: 500;">Contact:</span>
                                <span style="color: var(--text-primary); font-weight: 500;">${agent.guarantor_number || 'N/A'}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; padding: 4px 0; border-top: 1px solid var(--border-color); font-size: 12px;">
                                <span style="color: var(--text-secondary); font-weight: 500;">GH-Card ID:</span>
                                <span style="color: var(--text-primary); font-weight: 500;">${agent.guarantor_validation_number || 'N/A'}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Client Statistics -->
                    <div style="background: var(--background); padding: 12px; border-radius: 6px; border: 1px solid var(--border-color);">
                        <h4 style="margin: 0 0 10px 0; font-size: 13px; font-weight: 600; color: var(--text-primary); border-bottom: 1px solid var(--border-color); padding-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Client Statistics</h4>
                        <div style="display: grid; gap: 8px;">
                            <div style="display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px;">
                                <span style="color: var(--text-secondary); font-weight: 500;">Total Clients:</span>
                                <span style="color: var(--primary-color); font-weight: 600; font-size: 13px;">${stats.total_clients || 0}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; padding: 4px 0; border-top: 1px solid var(--border-color); font-size: 12px;">
                                <span style="color: var(--text-secondary); font-weight: 500;">Male:</span>
                                <span style="color: var(--text-primary); font-weight: 500;">${stats.male_count || 0}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; padding: 4px 0; border-top: 1px solid var(--border-color); font-size: 12px;">
                                <span style="color: var(--text-secondary); font-weight: 500;">Female:</span>
                                <span style="color: var(--text-primary); font-weight: 500;">${stats.female_count || 0}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; padding: 4px 0; border-top: 1px solid var(--border-color); font-size: 12px;">
                                <span style="color: var(--text-secondary); font-weight: 500;">Other:</span>
                                <span style="color: var(--text-primary); font-weight: 500;">${stats.other_count || 0}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; padding: 6px 0; border-top: 2px solid var(--border-color); margin-top: 2px; font-size: 12px;">
                                <span style="color: var(--text-secondary); font-weight: 600;">Total Balance:</span>
                                <span style="color: var(--success-color); font-weight: 700; font-size: 13px;">${formatCurrency(stats.total_balance)}</span>
                            </div>
                        </div>
                    </div>
                </div>
                </div>
                <div class="dialog-footer">
                    <button class="dialog-btn dialog-btn-primary" id="agentDialogClose">Close</button>
                </div>
            `;

            overlay.appendChild(dialog);
            document.body.appendChild(overlay);
            
            // Show dialog with animation (same pattern as other dialogs)
            setTimeout(() => {
                overlay.classList.add('show');
            }, 10);

            // Close handlers
            const closeDialog = () => {
                overlay.classList.remove('show');
                setTimeout(() => {
                    overlay.remove();
                    const customStyle = document.getElementById('agentDialogCustomStyles');
                    if (customStyle) {
                        customStyle.remove();
                    }
                }, 300);
            };

            const closeBtn = document.getElementById('agentDialogClose');
            if (closeBtn) {
                closeBtn.addEventListener('click', closeDialog);
            }

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    closeDialog();
                }
            });

            // ESC key to close
            const escHandler = (e) => {
                if (e.key === 'Escape') {
                    closeDialog();
                    document.removeEventListener('keydown', escHandler);
                }
            };
            document.addEventListener('keydown', escHandler);

        } catch (error) {
            console.error('Error showing agent dialog:', error);
            if (typeof Dialog !== 'undefined') {
                Dialog.error('Failed to load agent information', 'Error');
            } else {
                alert('Failed to load agent information');
            }
        }
    }
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.ViewAgentDialog = ViewAgentDialog;
}


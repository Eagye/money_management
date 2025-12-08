# Complete Commission System Logic Explanation

## 📋 Overview

The commission system automatically deducts commission (the "31st box") when clients make withdrawals. **Commission is ONLY deducted when a FULL page (31 boxes) is completed**, not when a page is just "touched". The system processes withdrawals page-by-page, deducting commission only for fully completed pages.

---

## 🏗️ Core Concepts

### 1. **Commission Threshold**
- **Formula**: `COMMISSION_THRESHOLD = 31 × client_rate`
- **Example**: If client rate is ₵10, threshold = 31 × 10 = ₵310
- **Meaning**: One full page equals 31 boxes worth of withdrawals

### 2. **Commission Amount**
- **Formula**: `Commission = Number of FULL pages completed × client_rate`
- **Key Point**: Commission is deducted ONLY when a full page (31 boxes) is completed
- **Example**: 
  - Withdrawal: ₵900, Rate: ₵10, Threshold: ₵310
  - Page 1: ₵310 completed → Commission ₵10, Client gets ₵300
  - Page 2: ₵310 completed → Commission ₵10, Client gets ₵300
  - Page 3: ₵280 (incomplete) → No commission, Client gets ₵280
  - **Total Commission: ₵20** (2 full pages × ₵10)

### 3. **Cumulative Withdrawal Tracking**
- Each client has a `commission_cycles` record tracking their cumulative withdrawal amount
- This tracks how much is accumulated in the **current incomplete page**
- Resets to 0 after full withdrawal, or continues tracking if page is incomplete

---

## 🔄 Commission Calculation Flow

### **Step 1: Initial Checks**
1. Validate withdrawal amount and client balance
2. Validate client rate is positive (> 0)
3. Get client's current rate and balance
4. Retrieve current cumulative withdrawal from `commission_cycles` table
5. Handle edge case: If cumulative >= threshold (data inconsistency), reset to remainder
6. Calculate commission threshold: `31 × client_rate`

### **Step 2: Determine Withdrawal Type**

#### **A. Full/Most Withdrawal** (`isWithdrawingAllOrMost`)
- **Condition**: `balance_after_withdrawal < client_rate`
- **Meaning**: Client is withdrawing all or most of their balance
- **Special Handling**: 
  - Even if last page is incomplete, deduct commission for it
  - Reset cumulative to 0 after transaction

#### **B. Normal Withdrawal**
- **Condition**: `balance_after_withdrawal >= client_rate`
- **Meaning**: Client still has balance remaining
- **Standard Handling**: 
  - Process page-by-page
  - Deduct commission only for FULL pages completed
  - Track incomplete pages in cumulative

### **Step 3: Page-by-Page Processing**

The system processes withdrawals **page by page**, only deducting commission when a **full page is completed**:

```javascript
// Process each page until withdrawal is fully processed
while (remainingWithdrawal > 0 && clientRate > 0) {
    neededForFullPage = COMMISSION_THRESHOLD - currentPageAmount
    
    if (remainingWithdrawal >= neededForFullPage) {
        // This withdrawal COMPLETES the current page (full page)
        // Deduct commission for this completed full page
        totalCommission += clientRate
        
        // Client gets: (amount already in page) + (needed for full page - commission)
        clientGetsFromThisPage = currentPageAmount + (neededForFullPage - clientRate)
        totalGivenToClient += clientGetsFromThisPage
        
        // Update remaining withdrawal
        remainingWithdrawal -= neededForFullPage
        
        // Move to next page (starts empty)
        currentPageAmount = 0
    } else {
        // This withdrawal doesn't complete the current page
        if (isWithdrawingAllOrMost && remainingWithdrawal > 0) {
            // Full withdrawal: deduct commission even for incomplete page
            totalCommission += clientRate
            clientGetsFromThisPage = currentPageAmount + (remainingWithdrawal - clientRate)
            totalGivenToClient += clientGetsFromThisPage
            remainingWithdrawal = 0
            currentPageAmount = 0
        } else {
            // Normal withdrawal: no commission for incomplete page
            currentPageAmount += remainingWithdrawal
            totalGivenToClient += remainingWithdrawal
            remainingWithdrawal = 0
        }
    }
}
```

### **Step 4: Update Cumulative Tracking**

#### **After Processing:**
```javascript
if (isWithdrawingAllOrMost) {
    remainingCumulative = 0  // Reset cycle (full withdrawal)
} else {
    remainingCumulative = currentPageAmount  // Amount left in current incomplete page
}
```

---

## 📊 Examples

### **Example 1: Withdrawal Completing Multiple Pages (Normal)**
- **Client Balance**: ₵1,000
- **Withdrawal**: ₵900
- **Rate**: ₵10
- **Current Cumulative**: ₵0
- **Threshold**: ₵310 (31 × 10)

**Page-by-Page Processing:**
1. **Page 1**: Needs ₵310, has ₵900 → Completes page
   - Commission: ₵10
   - Client gets: ₵300
   - Remaining: ₵590

2. **Page 2**: Needs ₵310, has ₵590 → Completes page
   - Commission: ₵10
   - Client gets: ₵300
   - Remaining: ₵280

3. **Page 3**: Needs ₵310, has ₵280 → Does NOT complete page
   - Commission: ₵0 (incomplete page)
   - Client gets: ₵280
   - Cumulative for next page: ₵280

**Result:**
- Total Commission: **₵20** (2 full pages × ₵10)
- Client receives: **₵880** (₵300 + ₵300 + ₵280)
- Total deduction: ₵880 + ₵20 = ₵900
- Final balance: ₵100
- Cumulative for next page: **₵280**

### **Example 2: Partial Withdrawal (Below Threshold)**
- **Client Balance**: ₵500
- **Withdrawal**: ₵200
- **Rate**: ₵10
- **Current Cumulative**: ₵0
- **Threshold**: ₵310

**Page-by-Page Processing:**
1. **Page 1**: Needs ₵310, has ₵200 → Does NOT complete page
   - Commission: ₵0 (incomplete page)
   - Client gets: ₵200
   - Cumulative for next page: ₵200

**Result:**
- Total Commission: **₵0**
- Client receives: **₵200**
- Total deduction: ₵200
- Final balance: ₵300
- Cumulative for next page: **₵200**

### **Example 3: Withdrawal Completing Page (With Existing Cumulative)**
- **Client Balance**: ₵500
- **Withdrawal**: ₵150
- **Rate**: ₵10
- **Current Cumulative**: ₵200 (from previous example)
- **Threshold**: ₵310

**Page-by-Page Processing:**
1. **Page 1**: Current page has ₵200, needs ₵110 more to complete
   - Withdrawal has ₵150 → Completes page (₵200 + ₵110 = ₵310)
   - Commission: ₵10
   - Client gets: ₵200 + (₵110 - ₵10) = ₵300
   - Remaining: ₵40

2. **Page 2**: Needs ₵310, has ₵40 → Does NOT complete page
   - Commission: ₵0 (incomplete page)
   - Client gets: ₵40
   - Cumulative for next page: ₵40

**Result:**
- Total Commission: **₵10** (1 full page × ₵10)
- Client receives: **₵340** (₵300 + ₵40)
- Total deduction: ₵340 + ₵10 = ₵350
- Final balance: ₵150
- Cumulative for next page: **₵40**

### **Example 4: Full Withdrawal (All Money)**
- **Client Balance**: ₵900
- **Withdrawal**: ₵900 (all)
- **Rate**: ₵10
- **Current Cumulative**: ₵0
- **Threshold**: ₵310

**Page-by-Page Processing:**
1. **Page 1**: Needs ₵310, has ₵900 → Completes page
   - Commission: ₵10
   - Client gets: ₵300
   - Remaining: ₵590

2. **Page 2**: Needs ₵310, has ₵590 → Completes page
   - Commission: ₵10
   - Client gets: ₵300
   - Remaining: ₵280

3. **Page 3**: Needs ₵310, has ₵280 → Does NOT complete page
   - **BUT**: This is a full withdrawal → Deduct commission anyway
   - Commission: ₵10
   - Client gets: ₵280 - ₵10 = ₵270

**Result:**
- Total Commission: **₵30** (3 pages × ₵10, including incomplete last page)
- Client receives: **₵870** (₵300 + ₵300 + ₵270)
- Total deduction: ₵870 + ₵30 = ₵900
- Final balance: **₵0**
- Cumulative: **₵0** (reset due to full withdrawal)

---

## 🔄 Withdrawal Reversal Logic

When a withdrawal is reversed:

### **Step 1: Restore Balance**
- Add back withdrawal amount
- Add back commission amount (if commission was deducted)

### **Step 2: Adjust Cumulative**
```javascript
if (commission was deducted) {
    // Subtract withdrawal amount from current cumulative
    newCumulative = currentCumulative - withdrawalAmount
    // Ensure it doesn't go below 0
    newCumulative = Math.max(0, newCumulative)
} else {
    // No commission, just subtract withdrawal
    newCumulative = Math.max(0, currentCumulative - withdrawalAmount)
}
```

### **Step 3: Create Reversal Transactions**
- Create deposit transaction reversing the withdrawal
- Create deposit transaction reversing the commission (if applicable)
- Update client balance
- Update commission cycle cumulative

---

## 🗄️ Database Structure

### **commission_cycles Table**
```sql
CREATE TABLE commission_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL UNIQUE,
    cumulative_withdrawal REAL DEFAULT 0.00,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
)
```

### **Key Fields:**
- `client_id`: Links to client (one-to-one relationship)
- `cumulative_withdrawal`: Running total of withdrawals toward next threshold
- `updated_at`: Last time the cycle was updated

### **Transaction Records:**
- Withdrawal transactions: `transaction_type = 'withdrawal'`
- Commission transactions: `transaction_type = 'commission'`
- Commission transactions link to withdrawal via `related_transaction_id`

---

## ⚙️ Special Cases & Edge Cases

### **1. Multiple Pages in One Withdrawal**
- If withdrawal completes multiple full pages, commission = full pages × rate
- Example: ₵900 withdrawal with ₵310 threshold = 2 full pages = 2 × rate = ₵20
- Remaining ₵280 doesn't complete a page, so no commission for it (unless full withdrawal)

### **2. Partial Page Completion**
- **Normal withdrawal**: No commission for incomplete pages
- **Full withdrawal**: Commission is deducted even for incomplete last page
- Example: ₵280 withdrawal with ₵310 threshold = No commission (incomplete page)
- Example: ₵280 withdrawal (full withdrawal) = Commission ₵10 deducted

### **3. Rate Changes**
- When client rate changes, new threshold applies to future withdrawals
- Existing cumulative continues with new threshold calculation
- If cumulative >= new threshold (data inconsistency), it's reset to remainder

### **4. Insufficient Balance**
- System checks: `balance >= withdrawal + commission`
- If insufficient, transaction is rejected with detailed error message showing:
  - Withdrawal amount
  - Commission amount
  - Total required
  - Available balance
  - Shortfall amount

### **5. Zero Balance After Withdrawal (Full Withdrawal)**
- If client withdraws all/most, cumulative resets to 0
- Commission is deducted for all pages, including incomplete last page
- Client receives: (balance - all commissions)

### **6. Zero or Negative Client Rate**
- System validates that client rate > 0 before processing
- If rate is 0 or negative, transaction is rejected with error

### **7. Cumulative Already at/Exceeds Threshold**
- Edge case: If cumulative >= threshold (data inconsistency)
- System automatically resets to remainder: `cumulative % threshold`
- Warning is logged for debugging

---

## 🔍 Commission Cycle Management

### **Get Commission Cycle:**
```javascript
CommissionCycle.get(clientId)
// Returns: { client_id, cumulative_withdrawal, updated_at }
```

### **Reset Commission Cycle:**
```javascript
CommissionCycle.reset(clientId)
// Sets cumulative_withdrawal to 0
```

### **Adjust Commission Cycle:**
```javascript
CommissionCycle.adjust(clientId, newCumulative)
// Manually set cumulative (for corrections)
```

### **Get Pending Cycles:**
```javascript
CommissionCycle.getPending()
// Returns clients with cumulative > 0 but < threshold
```

---

## 📝 Transaction Notes

### **Commission Transaction Notes:**

**For Normal Withdrawals:**
```
"Auto commission (31st box) - 2 full pages completed (threshold: ₵310.00 = 31 boxes per page)"
```

**For Full Withdrawals:**
```
"Auto commission (31st box) - deducted due to full/complete withdrawal (client withdrawing all/most of balance)"
```

---

## 🎯 Key Design Principles

1. **Automatic Deduction**: Commission is calculated and deducted automatically
2. **Page-by-Page Processing**: System processes withdrawals page by page, only deducting commission when a FULL page is completed
3. **Cumulative Tracking**: System tracks cumulative withdrawals (amount in current incomplete page) across multiple transactions
4. **Full Page Completion Required**: Commission is ONLY deducted when a full page (31 boxes) is completed, not when a page is just "touched"
5. **Full Withdrawal Handling**: Special logic ensures commissions are deducted even for incomplete last page when client withdraws all/most
6. **Atomic Transactions**: All operations (withdrawal, commission, balance update, cycle update) happen in a single database transaction
7. **Reversibility**: Withdrawals can be reversed, properly adjusting cumulative and refunding commission
8. **Edge Case Handling**: System handles data inconsistencies (cumulative >= threshold) and validates client rate > 0

---

## 🔐 Security & Validation

1. **Agent Authorization**: Verifies client belongs to the agent making the transaction
2. **Balance Validation**: Ensures sufficient balance before processing
3. **Transaction Integrity**: All operations wrapped in database transactions (BEGIN/COMMIT/ROLLBACK)
4. **Data Consistency**: Commission cycle updates are atomic with transaction creation

---

## 📈 Performance Considerations

1. **Indexed Queries**: `commission_cycles.client_id` is indexed for fast lookups
2. **Single Transaction**: All database operations in one transaction for consistency
3. **Lazy Initialization**: Commission cycle record created only when needed (on first withdrawal)

---

This system ensures accurate commission tracking while maintaining data integrity and providing flexibility for edge cases.


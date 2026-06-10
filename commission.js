const BOXES_PER_PAGE = 31;

function roundMoney(value) {
    return Math.round((parseFloat(value) + Number.EPSILON) * 100) / 100;
}

function moneyToBoxes(amount, boxRate) {
    const rate = parseFloat(boxRate);
    if (!rate || rate <= 0) {
        return 0;
    }
    const boxes = amount / rate;
    if (Math.abs(boxes - Math.round(boxes)) > 0.001) {
        return null;
    }
    return Math.round(boxes);
}

function separatePageStructure(activeBoxes) {
    const active = Math.max(0, Math.floor(activeBoxes));
    return {
        active_boxes: active,
        full_pages: Math.floor(active / BOXES_PER_PAGE),
        partial_boxes: active % BOXES_PER_PAGE
    };
}

/**
 * Rule C — commission boxes for withdrawing W boxes from an account with A active boxes.
 * Active boxes are structured as complete 31-box pages plus a partial incomplete page.
 */
function commissionBoxesForWithdrawal(activeBoxes, boxesToWithdraw, deferralActive) {
    const active = Math.max(0, Math.floor(activeBoxes));
    const withdraw = Math.max(0, Math.floor(boxesToWithdraw));

    if (withdraw <= 0 || withdraw > active) {
        return 0;
    }

    const fullPagesInAccount = Math.floor(active / BOXES_PER_PAGE);
    const partialInAccount = active % BOXES_PER_PAGE;

    const fullPagesWithdrawn = Math.min(fullPagesInAccount, Math.floor(withdraw / BOXES_PER_PAGE));
    let commissionBoxes = fullPagesWithdrawn;

    let remainingWithdrawal = withdraw - (fullPagesWithdrawn * BOXES_PER_PAGE);
    const partialWithdrawnFromAccount = Math.min(partialInAccount, remainingWithdrawal);
    remainingWithdrawal -= partialWithdrawnFromAccount;

    if (partialWithdrawnFromAccount > 0 && !deferralActive) {
        commissionBoxes += 1;
    }

    if (remainingWithdrawal > 0) {
        const extraFullPages = Math.floor(remainingWithdrawal / BOXES_PER_PAGE);
        commissionBoxes += extraFullPages;
        if (remainingWithdrawal % BOXES_PER_PAGE > 0 && !deferralActive) {
            commissionBoxes += 1;
        }
    }

    return commissionBoxes;
}

function buildWithdrawalSummary(activeBoxes, boxRate, deferralActive, boxesToWithdraw) {
    const rate = parseFloat(boxRate);
    const withdraw = Math.floor(boxesToWithdraw);
    const commissionBoxes = commissionBoxesForWithdrawal(activeBoxes, withdraw, deferralActive);
    const netBoxes = withdraw - commissionBoxes;
    const payout = roundMoney(netBoxes * rate);
    const totalDeduction = roundMoney(withdraw * rate);
    const commissionAmount = roundMoney(commissionBoxes * rate);
    const structure = separatePageStructure(activeBoxes);
    const withdrawalStructure = separatePageStructure(withdraw);
    const remainingBoxes = activeBoxes - withdraw;

    return {
        box_rate: rate,
        deferral_active: !!deferralActive,
        active_boxes: activeBoxes,
        active_full_pages: structure.full_pages,
        active_partial_boxes: structure.partial_boxes,
        boxes_to_withdraw: withdraw,
        withdrawal_full_pages: withdrawalStructure.full_pages,
        withdrawal_partial_boxes: withdrawalStructure.partial_boxes,
        commission_boxes: commissionBoxes,
        commission_amount: commissionAmount,
        net_boxes_paid: netBoxes,
        payout,
        total_deduction: totalDeduction,
        remaining_boxes: remainingBoxes,
        remaining_balance: roundMoney(remainingBoxes * rate)
    };
}

/**
 * Prefer solutions that leave an existing partial page untouched (e.g. withdraw one full page only).
 */
function scoreWithdrawalSolution(summary, partialInAccount) {
    let score = 0;

    if (partialInAccount > 0 && summary.remaining_boxes > 0) {
        if (summary.remaining_boxes === partialInAccount) {
            score += 1000;
        }
    }

    score += summary.commission_boxes * 10;
    score -= summary.boxes_to_withdraw;
    return score;
}

/**
 * Solve for gross boxes to withdraw when client requests a net cash payout (Rule D).
 */
function solveWithdrawalFromPayout(activeBoxes, boxRate, deferralActive, requestedPayout) {
    const rate = parseFloat(boxRate);
    const payout = roundMoney(requestedPayout);
    const active = Math.floor(activeBoxes);

    if (!rate || rate <= 0) {
        throw new Error('Client box rate must be greater than 0');
    }
    if (active <= 0) {
        throw new Error('Client has no active boxes to withdraw');
    }
    if (payout <= 0) {
        throw new Error('Withdrawal payout must be greater than 0');
    }

    const targetNetBoxes = moneyToBoxes(payout, rate);
    if (targetNetBoxes === null || targetNetBoxes <= 0) {
        throw new Error(`Withdrawal payout must be a whole number of boxes (multiples of ₵${rate.toFixed(2)})`);
    }

    const partialInAccount = active % BOXES_PER_PAGE;
    let bestMatch = null;
    let bestScore = -Infinity;

    for (let boxesToWithdraw = targetNetBoxes; boxesToWithdraw <= active; boxesToWithdraw += 1) {
        const summary = buildWithdrawalSummary(active, rate, deferralActive, boxesToWithdraw);
        if (summary.net_boxes_paid !== targetNetBoxes) {
            continue;
        }

        const score = scoreWithdrawalSolution(summary, partialInAccount);
        if (score > bestScore) {
            bestScore = score;
            bestMatch = summary;
        }
    }

    if (bestMatch) {
        return bestMatch;
    }

    const maxSummary = buildWithdrawalSummary(active, rate, deferralActive, active);
    throw new Error(
        `Insufficient balance for payout of ₵${payout.toFixed(2)}. ` +
        `Maximum available payout is ₵${maxSummary.payout.toFixed(2)} (${maxSummary.net_boxes_paid} boxes).`
    );
}

/**
 * Rule A — derive active boxes from monetary ledger.
 */
function computeBoxLedger(totals, boxRate) {
    const rate = parseFloat(boxRate);
    const lifetimeFilled = moneyToBoxes(totals.deposits || 0, rate) || 0;
    const withdrawn = moneyToBoxes(totals.withdrawals || 0, rate) || 0;
    const commission = moneyToBoxes(totals.commissions || 0, rate) || 0;
    const activeBoxes = Math.max(0, lifetimeFilled - withdrawn - commission);

    return {
        lifetime_filled_boxes: lifetimeFilled,
        withdrawn_boxes: withdrawn,
        commission_boxes: commission,
        active_boxes: activeBoxes,
        ...separatePageStructure(activeBoxes)
    };
}

module.exports = {
    BOXES_PER_PAGE,
    roundMoney,
    moneyToBoxes,
    separatePageStructure,
    commissionBoxesForWithdrawal,
    buildWithdrawalSummary,
    scoreWithdrawalSolution,
    solveWithdrawalFromPayout,
    computeBoxLedger
};

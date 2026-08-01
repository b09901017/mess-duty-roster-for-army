/* 人員名冊管理：新增/編輯/退伍、固定送便當人力異動 */
window.App = window.App || {};

(function () {
  "use strict";

  function nextSeq(cohort) {
    const state = window.App.State.get();
    const seqs = state.members.filter((m) => m.cohort === cohort).map((m) => m.seq);
    return seqs.length ? Math.max(...seqs) + 1 : 1;
  }

  function addMember({ name, cohort }) {
    const state = window.App.State.get();
    const seq = nextSeq(cohort);
    const id = `${cohort}-${seq}-${Date.now().toString(36)}`;
    state.members.push({
      id,
      name: name || `${cohort}-${seq}號`,
      cohort,
      seq,
      dischargeDate: null,
      active: true,
      fixedRole: null,
    });
    state.dutyCounts[id] = window.App.State.emptyDutyCount();
    window.App.State.save();
    return id;
  }

  function updateMember(id, patch) {
    const state = window.App.State.get();
    const member = state.members.find((m) => m.id === id);
    if (!member) return;
    Object.assign(member, patch);
    window.App.State.save();
  }

  /**
   * @returns {{ deliveryVacancy: boolean }} - deliveryVacancy=true 代表退伍者是固定送便當，需要手動指定新人
   */
  function dischargeMember(id, dischargeDate) {
    const state = window.App.State.get();
    const member = state.members.find((m) => m.id === id);
    if (!member) return { deliveryVacancy: false };

    member.active = false;
    member.dischargeDate = dischargeDate || new Date().toISOString().slice(0, 10);
    const wasDelivery = member.fixedRole === "delivery";
    if (wasDelivery) {
      member.fixedRole = null;
    }
    window.App.State.save();
    return { deliveryVacancy: wasDelivery };
  }

  function reactivateMember(id) {
    updateMember(id, { active: true, dischargeDate: null });
  }

  function getDeliveryMembers() {
    return window.App.State.activeMembers().filter((m) => m.fixedRole === "delivery");
  }

  /**
   * 手動指定新的固定送便當人員（會清掉其他人的 delivery 標記，設定為指定的這幾位）
   * @param {string[]} memberIds
   */
  function setDeliveryMembers(memberIds) {
    const state = window.App.State.get();
    state.members.forEach((m) => {
      if (m.fixedRole === "delivery") m.fixedRole = null;
    });
    memberIds.forEach((id) => {
      const member = state.members.find((m) => m.id === id);
      if (member) member.fixedRole = "delivery";
    });
    window.App.State.save();
  }

  window.App.Roster = {
    addMember,
    updateMember,
    dischargeMember,
    reactivateMember,
    getDeliveryMembers,
    setDeliveryMembers,
  };
})();

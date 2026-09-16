import Image from "next/image";
import Link from "next/link";
import type { loadPeopleDirectory } from "@/lib/team/people-directory-read";
import { employeeCount, peopleEmptyCopy, peopleFilter, peopleListPath, testAccountFilter, type PeopleContext, type PeopleFilter, type PeopleIssueCategory } from "@/lib/team/people-presentation";
import { formatHrCalendarMonth } from "@/lib/hr-calendar-month";
import styles from "./people-directory.module.css";

const views: { key: PeopleFilter; label: string }[] = [
  { key: "all", label: "All employees" },
  { key: "ready", label: "Ready" },
  { key: "attention", label: "Needs attention" },
  { key: "inactive", label: "Inactive" },
];
type Props = {
  data: NonNullable<Awaited<ReturnType<typeof loadPeopleDirectory>>>;
  context: PeopleContext;
  branches: { id: string; name: string }[];
  canAddEmployee?: boolean;
};

export function PeopleDirectory({ data, context, branches, canAddEmployee = false }: Props) {
  const zh=data.language==="ZH",t=(en:string,chinese:string)=>zh?chinese:en;
  const back = peopleListPath(context), currentView = peopleFilter(context.filter);
  const clearHref = peopleListPath({ month: data.month, fromHrHome: context.fromHrHome, homeMonth: context.homeMonth });
  const isFiltered = currentView !== "all" || Boolean(context.q?.trim() || context.branch || context.position || testAccountFilter(context.testAccounts) === "show");
  const month = zh?`${data.month.slice(0,4)}年${Number(data.month.slice(5))}月`:formatHrCalendarMonth(data.month);
  const attendanceCount = data.rows.filter(row => row.status === "ACTIVE" && row.issues.some(issue => issue.category === "ATTENDANCE")).length;
  const emptyCopy=zh?(data.summary.all?"没有员工符合当前筛选，请尝试其他状态、分店、职位或关键词。":"您的授权范围内没有员工记录。"):peopleEmptyCopy(data.summary.all,context);
  const firstItem = data.pagination.total ? (data.pagination.page - 1) * data.pagination.pageSize + 1 : 0;
  const lastItem = Math.min(data.pagination.page * data.pagination.pageSize, data.pagination.total);

  const viewLabels={all:t("All employees","所有员工"),ready:t("Ready","已就绪"),attention:t("Needs attention","需要处理"),inactive:t("Inactive","非在职")};
  return <section className={styles.directory} aria-label={t("Employee directory","员工目录")}>
    <nav className={styles.views} aria-label={t("Employee status filters","员工状态筛选")}>
      {views.map(view => <Link key={view.key} href={peopleListPath({ ...context, filter: view.key, page: "1" })} aria-current={currentView === view.key ? "page" : undefined}>
        {viewLabels[view.key]}<span className={styles.viewCount}>{data.summary[view.key]}</span>
      </Link>)}
    </nav>

    <div className={styles.toolbar}>
      <form key={back} action="/team" className={styles.filters}>
        <input type="hidden" name="section" value="people" />
        <input type="hidden" name="filter" value={currentView} />
        <label className={styles.search}>{t("Search employees","搜索员工")}
          <input type="search" name="q" defaultValue={context.q} placeholder={t("Name, employee code, mobile or email","姓名、员工编号、手机或电邮")} maxLength={120} />
        </label>
        <label>{t("Branch","分店")}<select name="branch" defaultValue={context.branch ?? ""}>
          <option value="">{t("All authorized branches","所有已授权分店")}</option>
          {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select></label>
        <label>{t("Payroll period","工资期间")}<input type="month" name="month" defaultValue={data.month} /></label>
        <details className={styles.moreFilters}>
          <summary>{t("More filters","更多筛选")}{context.position || context.testAccounts === "show" ? <span aria-label={t("Filters active","已启用筛选")}> •</span> : null}</summary>
          <div>
            <label>{t("Position","职位")}<select name="position" defaultValue={context.position ?? ""}>
              <option value="">{t("All positions","所有职位")}</option>
              {data.positions.map(position => <option key={position} value={position}>{position}</option>)}
            </select></label>
            <label>{t("Test accounts","测试账号")}<select name="testAccounts" defaultValue={testAccountFilter(context.testAccounts)}>
              <option value="hide">{t("Hide test accounts","隐藏测试账号")}</option><option value="show">{t("Show test accounts","显示测试账号")}</option>
            </select></label>
          </div>
        </details>
        <div className={styles.filterActions}>
          <button type="submit">{t("Apply filters","应用筛选")}</button>
          {isFiltered ? <Link href={clearHref}>{t("Clear filters","清除筛选")}</Link> : null}
        </div>
      </form>
      {testAccountFilter(context.testAccounts) === "hide" && data.hiddenTestAccounts ? <p className={styles.hiddenTests}>{zh?`${data.hiddenTestAccounts} 个已标记的测试账号默认隐藏。`:`${employeeCount(data.hiddenTestAccounts)} marked as test hidden by default.`}</p> : null}
    </div>

    {data.readinessStatus === "UNKNOWN" ? <div className={styles.notice} role="status">
      <span className={styles.noticeIcon} aria-hidden="true">!</span><div><strong>{t("Some readiness checks are temporarily unavailable","部分就绪检查暂时不可用")}</strong>
        <p>{t(`Employee records remain available. Do not treat an unchecked result as ready for ${month}.`,`员工记录仍可查看。请勿把 ${month} 未检查的结果视为已就绪。`)}</p></div>
    </div> : attendanceCount ? <div className={styles.notice} role="status">
      <span className={styles.noticeIcon} aria-hidden="true">!</span><div><strong>{zh?`本页有 ${attendanceCount} 名员工需要处理出勤`:`${employeeCount(attendanceCount)} on this page need attendance action`}</strong>
        <p>{t(`${month}. Open the employee or timesheet to review the exact blocker.`,`${month}。打开员工或工时表查看具体阻碍。`)}</p></div>
    </div> : null}

    <div className={styles.listHeading}>
      <h2>{zh?`${data.pagination.total} 名员工`:employeeCount(data.pagination.total)}<span>{isFiltered?t("matching your filters","符合当前筛选"):t("in your authorized scope","在您的授权范围内")}</span></h2>
      <details className={styles.readinessInfo}>
        <summary>{t("What is checked?","检查范围")} · {month}</summary>
        <p>{data.checkedScope}. {t("“Ready” only means no known blocker in this checked scope for this period; it is not payment approval or final filing confirmation.","“已就绪”仅表示本期间在此检查范围内没有已知阻碍，并不代表付款已批准或申报已最终确认。")}</p>
        {(!data.permissions.canAttendance || !data.permissions.canPayroll) ? <p className={styles.restricted}>{t("Some checks are restricted by your role and are not disclosed here.","部分检查受您的角色权限限制，因此不会在此披露。")}</p> : null}
      </details>
    </div>

    {data.rows.length ? <div className={styles.tableWrap}><table className={styles.employeeTable}>
      <caption className={styles.srOnly}>Employee profiles, employment, attendance and payroll readiness</caption>
      <thead><tr><th scope="col">{t("Employee","员工")}</th><th scope="col">{t("Position","职位")}</th><th scope="col">{t("Branch","分店")}</th><th scope="col">{t("Employment","雇佣状态")}</th><th scope="col">{t("Attendance","出勤")}</th><th scope="col">{t("Payroll readiness","工资就绪")}</th><th scope="col"><span className={styles.srOnly}>{t("Actions","操作")}</span></th></tr></thead>
      <tbody>{data.rows.map(row => <EmployeeRow key={row.id} row={row} back={back} month={data.month} canAttendance={data.permissions.canAttendance} canPayroll={data.permissions.canPayroll} canEditProfile={data.permissions.canEditProfile} zh={zh} />)}</tbody>
    </table></div> : <div className={styles.empty}>
      <h3>{data.summary.all ? t("No employees match these filters","没有员工符合当前筛选") : t("No employee records in this scope","此范围内没有员工记录")}</h3>
      <p>{emptyCopy}</p>
      {data.summary.all ? <Link href={clearHref}>{t("Clear filters","清除筛选")}</Link> : canAddEmployee ? <Link href={`${back}&modal=create`}>{t("Add employee","新增员工")}</Link> : null}
    </div>}

    {data.pagination.total ? <div className={styles.pagination} aria-label="Employee pagination">
      <span>{zh?`显示 ${firstItem}–${lastItem}，共 ${data.pagination.total} 名`: `Showing ${firstItem}–${lastItem} of ${data.pagination.total}`}</span>
      <div><Link aria-disabled={data.pagination.page === 1} href={peopleListPath({ ...context, page: String(Math.max(1, data.pagination.page - 1)) })}>{t("Previous","上一页")}</Link>
        <span>{zh?`第 ${data.pagination.page} / ${data.pagination.totalPages} 页`:`Page ${data.pagination.page} of ${data.pagination.totalPages}`}</span>
        <Link aria-disabled={data.pagination.page === data.pagination.totalPages} href={peopleListPath({ ...context, page: String(Math.min(data.pagination.totalPages, data.pagination.page + 1)) })}>{t("Next","下一页")}</Link></div>
    </div> : null}
  </section>;
}

function EmployeeRow({ row, back, month, canAttendance, canPayroll, canEditProfile, zh }: {
  row: NonNullable<Awaited<ReturnType<typeof loadPeopleDirectory>>>["rows"][number];
  back: string; month: string; canAttendance: boolean; canPayroll: boolean; canEditProfile:boolean; zh:boolean;
}) {
  const t=(en:string,chinese:string)=>zh?chinese:en;
  const profileHref = `/team/people/${row.id}?peopleReturn=${encodeURIComponent(back)}`;
  const profileIssue = row.issues.find(issue => issue.category === "PROFILE");
  const attendanceIssue = row.issues.find(issue => issue.category === "ATTENDANCE");
  const payrollIssue = row.issues.find(issue => issue.category === "PAYROLL");
  const active = row.status === "ACTIVE";
  const primary = primaryAction(profileHref, month, active ? profileIssue?.category ?? attendanceIssue?.category ?? payrollIssue?.category : undefined, canAttendance, canPayroll, canEditProfile, zh);
  const employmentLabel = row.readiness === "ONBOARDING" ? t("Onboarding","入职中") : active ? t("Active","在职") : row.status === "TERMINATED" ? t("Terminated / resigned","已终止 / 已离职") : t("Suspended","已暂停");
  const attendance = !active ? [t("Not required","无需处理"),t("Employment inactive","非在职状态")] : !canAttendance ? [t("Restricted","权限受限"),t("Not available to your role","您的角色无权查看")] : attendanceIssue ? [t("Action required","需要处理"),attendanceIssue.message] : row.attendanceChecked ? [t("Ready","已就绪"),t("No known attendance blocker","没有已知出勤阻碍")] : [t("Not checked","未检查"),t("No authorized source available","没有可用的授权来源")];
  const payroll = !active ? [t("Historical","历史记录"),t("Employment inactive","非在职状态")] : !canPayroll ? [t("Restricted","权限受限"),t("Not available to your role","您的角色无权查看")] : payrollIssue ? [payrollIssue.code === "READINESS_UNAVAILABLE" ? t("Not checked","未检查") : t("Setup incomplete","设置未完成"),payrollIssue.message] : row.payrollChecked ? [t("Ready","已就绪"),t("No known payroll setup blocker","没有已知工资设置阻碍")] : [t("Not checked","未检查"),t("No authorized source available","没有可用的授权来源")];
  return <tr data-readiness={row.readiness}>
    <th scope="row" className={styles.employee}>
      <Link href={profileHref} className={styles.identity}>
        <span className={styles.avatar}>{row.avatarUrl ? <Image src={row.avatarUrl} width={36} height={36} alt="" unoptimized /> : initials(row.fullName)}</span>
        <span><strong>{row.fullName || t("Unnamed employee","未命名员工")}</strong><small>{row.employeeCode || t("No employee code","无员工编号")}{row.isTestAccount ? <em>{t("Test","测试")}</em> : null}</small></span>
      </Link>
    </th>
    <td><span className={styles.mobileLabel}>{t("Position","职位")}</span>{row.position || <span className={styles.missing}>{t("Not set","未设置")}</span>}</td>
    <td><span className={styles.mobileLabel}>{t("Branch","分店")}</span>{row.branches.map(branch => branch.name).join(", ") || <span className={styles.missing}>{t("Not assigned","未分配")}</span>}</td>
    <td><span className={styles.mobileLabel}>{t("Employment","雇佣状态")}</span><Status label={employmentLabel} tone={active ? "positive" : "neutral"} /><small className={styles.cellNote}>{profileIssue?.message}</small></td>
    <td><span className={styles.mobileLabel}>{t("Attendance","出勤")}</span><Status label={attendance[0]} tone={attendanceIssue ? "warning" : row.attendanceChecked&&active ? "positive" : "neutral"} /><small className={styles.cellNote}>{attendance[1]}</small></td>
    <td><span className={styles.mobileLabel}>{t("Payroll readiness","工资就绪")}</span><Status label={payroll[0]} tone={payrollIssue && payrollIssue.code!=="READINESS_UNAVAILABLE" ? "warning" : row.payrollChecked&&active&&!payrollIssue ? "positive" : "neutral"} /><small className={styles.cellNote}>{payroll[1]}</small>{active && row.issues.length > 1 ? <Link className={styles.moreIssues} href={profileHref}>{zh?`另有 ${row.issues.length-1} 项`: `${row.issues.length - 1} more item${row.issues.length === 2 ? "" : "s"}`}</Link> : null}</td>
    <td className={styles.actions}><Link className={styles.primaryAction} href={primary.href}>{primary.label}<span aria-hidden="true"> →</span></Link>
      <details className={styles.actionMenu}><summary aria-label={t(`More actions for ${row.fullName}`,`${row.fullName} 的更多操作`)}>•••</summary><div><Link href={profileHref}>{t("View profile","查看资料")}</Link>{canAttendance ? <Link href={`/team/attendance/timesheets?month=${month}`}>{t("Review attendance","复核出勤")}</Link> : null}{canPayroll ? <Link href={`${profileHref}&section=compensation`}>{t("Payroll setup","工资设置")}</Link> : null}</div></details>
    </td>
  </tr>;
}

function Status({ label, tone }: { label: string; tone: "positive" | "warning" | "neutral" }) { return <span className={styles.status} data-tone={tone}>{label}</span>; }
function primaryAction(profileHref:string, month:string, category:PeopleIssueCategory|undefined, canAttendance:boolean, canPayroll:boolean,canEditProfile:boolean,zh:boolean) {
  if (category === "ATTENDANCE" && canAttendance) return { label: zh?"复核工时表":"Review timesheet", href: `/team/attendance/timesheets?month=${month}` };
  if (category === "PAYROLL" && canPayroll) return { label: zh?"复核设置":"Review setup", href: `${profileHref}&section=compensation` };
  return { label: category === "PROFILE" && canEditProfile ? zh?"完善资料":"Complete profile" : zh?"查看员工":"View employee", href: profileHref };
}
function initials(name:string){return name.trim().split(/\s+/).slice(0,2).map(part=>part[0]?.toUpperCase()).join("")||"?";}

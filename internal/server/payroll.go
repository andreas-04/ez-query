package server

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"time"

	commonv1 "otto/internal/gen/common/v1"
	payrollv1 "otto/internal/gen/payroll/v1"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// PayrollServer implements payrollv1.PayrollServiceServer against Postgres.
type PayrollServer struct {
	payrollv1.UnimplementedPayrollServiceServer
	db *sql.DB
}

// NewPayrollServer wires up the server with an open database connection.
func NewPayrollServer(db *sql.DB) *PayrollServer {
	return &PayrollServer{db: db}
}

// quarterRE matches strings like "2024-Q1".
var quarterRE = regexp.MustCompile(`^(\d{4})-Q([1-4])$`)

// GetPayroll returns pay runs for an employee, scoped by an optional period qualifier.
func (s *PayrollServer) GetPayroll(ctx context.Context, req *payrollv1.GetPayrollRequest) (*payrollv1.GetPayrollResponse, error) {
	if req.EmployeeId == "" {
		return nil, status.Error(codes.InvalidArgument, "employee_id is required")
	}

	query := `
		SELECT id, employee_id,
		       period_start::text, period_end::text,
		       gross_amount, gross_currency,
		       net_amount, net_currency,
		       status, COALESCE(paid_at::text, '')
		FROM pay_runs
		WHERE employee_id = $1`
	args := []any{req.EmployeeId}

	if req.PayPeriod != nil {
		pp := *req.PayPeriod
		switch {
		case pp == "latest":
			query += " ORDER BY period_end DESC LIMIT 1"

		case quarterRE.MatchString(pp):
			m := quarterRE.FindStringSubmatch(pp)
			year, _ := strconv.Atoi(m[1])
			quarter, _ := strconv.Atoi(m[2])
			startMonth := (quarter-1)*3 + 1
			endMonth := startMonth + 2
			start := fmt.Sprintf("%04d-%02d-01", year, startMonth)
			end := fmt.Sprintf("%04d-%02d-01", year, endMonth)
			// last day of end month via next month minus 1 day
			args = append(args, start, end)
			query += fmt.Sprintf(
				" AND period_start >= $%d AND period_start < $%d ORDER BY period_start",
				len(args)-1, len(args),
			)

		default:
			// treat as an exact ISO 8601 period_start date
			args = append(args, pp)
			query += fmt.Sprintf(" AND period_start = $%d ORDER BY period_start", len(args))
		}
	} else {
		query += " ORDER BY period_start"
	}

	q := dbQ(ctx, s.db)
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, dbErr(err, "query pay_runs")
	}
	defer rows.Close()

	var runs []*payrollv1.PayRun
	for rows.Next() {
		r, err := scanPayRun(rows)
		if err != nil {
			return nil, dbErr(err, "scan pay_run")
		}
		runs = append(runs, r)
	}
	if err := rows.Err(); err != nil {
		return nil, dbErr(err, "rows")
	}

	return &payrollv1.GetPayrollResponse{
		EmployeeId: req.EmployeeId,
		PayRuns:    runs,
	}, nil
}

// GetPaySchedule returns the pay schedule for an employee.
func (s *PayrollServer) GetPaySchedule(ctx context.Context, req *payrollv1.GetPayScheduleRequest) (*payrollv1.PaySchedule, error) {
	if req.EmployeeId == "" {
		return nil, status.Error(codes.InvalidArgument, "employee_id is required")
	}

	q := dbQ(ctx, s.db)
	row := q.QueryRowContext(ctx, `
		SELECT id, employee_id, frequency,
		       effective_date::text, next_pay_date::text
		FROM pay_schedules
		WHERE employee_id = $1`,
		req.EmployeeId,
	)

	var ps payrollv1.PaySchedule
	var freq int32
	err := row.Scan(&ps.Id, &ps.EmployeeId, &freq, &ps.EffectiveDate, &ps.NextPayDate)
	if err == sql.ErrNoRows {
		return nil, status.Error(codes.NotFound, "pay schedule not found for employee")
	}
	if err != nil {
		return nil, dbErr(err, "scan pay_schedule")
	}
	ps.Frequency = commonv1.PayFrequency(freq)
	return &ps, nil
}

// ListPayRuns returns a filtered list of pay runs for an employee.
func (s *PayrollServer) ListPayRuns(ctx context.Context, req *payrollv1.ListPayRunsRequest) (*payrollv1.ListPayRunsResponse, error) {
	if req.EmployeeId == "" {
		return nil, status.Error(codes.InvalidArgument, "employee_id is required")
	}

	query := `
		SELECT id, employee_id,
		       period_start::text, period_end::text,
		       gross_amount, gross_currency,
		       net_amount, net_currency,
		       status, COALESCE(paid_at::text, '')
		FROM pay_runs
		WHERE employee_id = $1`
	args := []any{req.EmployeeId}

	if req.DateRange != nil {
		args = append(args, req.DateRange.StartDate, req.DateRange.EndDate)
		query += fmt.Sprintf(
			" AND period_start <= $%d AND period_end >= $%d",
			len(args)-1, len(args),
		)
	}
	if req.Status != nil {
		args = append(args, *req.Status)
		query += fmt.Sprintf(" AND status = $%d", len(args))
	}
	query += " ORDER BY period_start"

	q2 := dbQ(ctx, s.db)
	rows, err := q2.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, dbErr(err, "query pay_runs")
	}
	defer rows.Close()

	var runs []*payrollv1.PayRun
	for rows.Next() {
		r, err := scanPayRun(rows)
		if err != nil {
			return nil, dbErr(err, "scan pay_run")
		}
		runs = append(runs, r)
	}
	if err := rows.Err(); err != nil {
		return nil, dbErr(err, "rows")
	}

	return &payrollv1.ListPayRunsResponse{
		PayRuns:    runs,
		TotalCount: int32(len(runs)),
	}, nil
}

// ---------------------------------------------------------------------------
// Scan helpers
// ---------------------------------------------------------------------------

func scanPayRun(rows *sql.Rows) (*payrollv1.PayRun, error) {
	var r payrollv1.PayRun
	var grossAmt, netAmt int64
	var grossCur, netCur string
	err := rows.Scan(
		&r.Id, &r.EmployeeId,
		&r.PeriodStart, &r.PeriodEnd,
		&grossAmt, &grossCur,
		&netAmt, &netCur,
		&r.Status, &r.PaidAt,
	)
	if err != nil {
		return nil, err
	}
	r.Gross = &commonv1.Money{Amount: grossAmt, CurrencyCode: grossCur}
	r.Net = &commonv1.Money{Amount: netAmt, CurrencyCode: netCur}
	return &r, nil
}

// ---------------------------------------------------------------------------
// GetPayRates
// ---------------------------------------------------------------------------

// GetPayRates returns the hourly rate card for an employee.
func (s *PayrollServer) GetPayRates(ctx context.Context, req *payrollv1.GetPayRatesRequest) (*payrollv1.PayRates, error) {
	if req.EmployeeId == "" {
		return nil, status.Error(codes.InvalidArgument, "employee_id is required")
	}
	q := dbQ(ctx, s.db)
	row := q.QueryRowContext(ctx, `
		SELECT id, employee_id, currency_code,
		       day_rate_cents, night_rate_cents, weekend_rate_cents, overtime_rate_cents,
		       overtime_threshold_hours, updated_at::text
		FROM pay_rates
		WHERE employee_id = $1`,
		req.EmployeeId,
	)
	pr, err := scanPayRates(row)
	if err == sql.ErrNoRows {
		return nil, status.Error(codes.NotFound, "pay rates not found for employee")
	}
	if err != nil {
		return nil, dbErr(err, "scan pay_rates")
	}
	return pr, nil
}

// ---------------------------------------------------------------------------
// SetPayRates
// ---------------------------------------------------------------------------

// SetPayRates creates or replaces the hourly rate card for an employee.
func (s *PayrollServer) SetPayRates(ctx context.Context, req *payrollv1.SetPayRatesRequest) (*payrollv1.PayRates, error) {
	if req.EmployeeId == "" {
		return nil, status.Error(codes.InvalidArgument, "employee_id is required")
	}
	if req.CurrencyCode == "" {
		return nil, status.Error(codes.InvalidArgument, "currency_code is required")
	}

	threshold := 40.0
	if req.OvertimeThresholdHours != nil {
		threshold = *req.OvertimeThresholdHours
	}

	q := dbQ(ctx, s.db)
	row := q.QueryRowContext(ctx, `
		INSERT INTO pay_rates (tenant_id, employee_id, currency_code,
		  day_rate_cents, night_rate_cents, weekend_rate_cents, overtime_rate_cents,
		  overtime_threshold_hours, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
		ON CONFLICT (tenant_id, employee_id) DO UPDATE SET
		  currency_code            = EXCLUDED.currency_code,
		  day_rate_cents           = EXCLUDED.day_rate_cents,
		  night_rate_cents         = EXCLUDED.night_rate_cents,
		  weekend_rate_cents       = EXCLUDED.weekend_rate_cents,
		  overtime_rate_cents      = EXCLUDED.overtime_rate_cents,
		  overtime_threshold_hours = EXCLUDED.overtime_threshold_hours,
		  updated_at               = NOW()
		RETURNING id, employee_id, currency_code,
		          day_rate_cents, night_rate_cents, weekend_rate_cents, overtime_rate_cents,
		          overtime_threshold_hours, updated_at::text`,
		TenantIDFromCtx(ctx), req.EmployeeId, req.CurrencyCode,
		req.DayRateCents, req.NightRateCents, req.WeekendRateCents, req.OvertimeRateCents,
		threshold,
	)
	pr, err := scanPayRates(row)
	if err != nil {
		return nil, dbErr(err, "upsert pay_rates")
	}
	return pr, nil
}

// ---------------------------------------------------------------------------
// CalculatePayPreview
// ---------------------------------------------------------------------------

// shiftRow is a minimal internal representation of a shift for pay calculation.
type shiftRow struct {
	start     time.Time
	end       time.Time
	completed bool // true = COMPLETED, false = SCHEDULED
}

// CalculatePayPreview computes a real-time pay breakdown for an employee.
func (s *PayrollServer) CalculatePayPreview(ctx context.Context, req *payrollv1.CalculatePayPreviewRequest) (*payrollv1.PayPreview, error) {
	if req.EmployeeId == "" {
		return nil, status.Error(codes.InvalidArgument, "employee_id is required")
	}

	// Resolve date range (default = current calendar month).
	now := time.Now().UTC()
	periodStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	periodEnd := periodStart.AddDate(0, 1, 0).Add(-time.Second) // last second of month

	if req.DateRange != nil {
		var err error
		periodStart, err = time.Parse("2006-01-02", req.DateRange.StartDate)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid start_date: %v", err)
		}
		endDay, err := time.Parse("2006-01-02", req.DateRange.EndDate)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid end_date: %v", err)
		}
		periodEnd = endDay.Add(24*time.Hour - time.Second)
	}

	// Fetch the employee's pay rates.
	q := dbQ(ctx, s.db)
	rateRow := q.QueryRowContext(ctx, `
		SELECT id, employee_id, currency_code,
		       day_rate_cents, night_rate_cents, weekend_rate_cents, overtime_rate_cents,
		       overtime_threshold_hours, updated_at::text
		FROM pay_rates WHERE employee_id = $1`,
		req.EmployeeId,
	)
	rates, err := scanPayRates(rateRow)
	if err == sql.ErrNoRows {
		return nil, status.Error(codes.NotFound, "pay rates not configured for employee — call set_pay_rates first")
	}
	if err != nil {
		return nil, dbErr(err, "fetch pay_rates")
	}

	// Fetch all SCHEDULED (1) and COMPLETED (2) shifts in the period.
	shiftDbRows, err := q.QueryContext(ctx, `
		SELECT start_time, end_time, status
		FROM shifts
		WHERE employee_id = $1
		  AND status IN (1, 2)
		  AND start_time <= $2
		  AND end_time   >= $3
		ORDER BY start_time`,
		req.EmployeeId,
		periodEnd,
		periodStart,
	)
	if err != nil {
		return nil, dbErr(err, "query shifts")
	}
	defer shiftDbRows.Close()

	var shifts []shiftRow
	for shiftDbRows.Next() {
		var startT, endT time.Time
		var shiftStatus int
		if err := shiftDbRows.Scan(&startT, &endT, &shiftStatus); err != nil {
			return nil, dbErr(err, "scan shift")
		}
		// Clamp to period boundaries.
		if startT.Before(periodStart) {
			startT = periodStart
		}
		if endT.After(periodEnd) {
			endT = periodEnd
		}
		shifts = append(shifts, shiftRow{
			start:     startT,
			end:       endT,
			completed: shiftStatus == 2,
		})
	}
	if err := shiftDbRows.Err(); err != nil {
		return nil, dbErr(err, "rows")
	}

	// ── Categorise hours ────────────────────────────────────────────────────
	// We track hours per ISO week to calculate overtime.
	var (
		totalDay, totalNight, totalWeekend    float64
		earnedDay, earnedNight, earnedWeekend float64
		completedCount, scheduledCount        int32
		weekBuckets                           = map[payWeekKey]*payWeekHours{}
		completedWeekBuckets                  = map[payWeekKey]*payWeekHours{}
	)

	for _, sh := range shifts {
		d, n, w := categoriseShiftHours(sh.start, sh.end)
		totalDay += d
		totalNight += n
		totalWeekend += w

		year, week := sh.start.ISOWeek()
		k := payWeekKey{year, week}
		if weekBuckets[k] == nil {
			weekBuckets[k] = &payWeekHours{}
		}
		weekBuckets[k].day += d
		weekBuckets[k].night += n

		if sh.completed {
			earnedDay += d
			earnedNight += n
			earnedWeekend += w
			completedCount++
			if completedWeekBuckets[k] == nil {
				completedWeekBuckets[k] = &payWeekHours{}
			}
			completedWeekBuckets[k].day += d
			completedWeekBuckets[k].night += n
		} else {
			scheduledCount++
		}
	}

	threshold := rates.OvertimeThresholdHours

	// Compute overtime hours per week for all shifts.
	totalOT := overtimeFromBuckets(weekBuckets, threshold)
	// Compute overtime hours for completed shifts only.
	earnedOT := overtimeFromBuckets(completedWeekBuckets, threshold)

	// Deduct overtime proportionally from day/night weekday hours.
	totalWeekday := totalDay + totalNight
	var regDay, regNight, otHours float64
	if totalWeekday > 0 {
		otHours = totalOT
		regDay = totalDay * (1 - totalOT/totalWeekday)
		regNight = totalNight * (1 - totalOT/totalWeekday)
	}

	earnedWeekday := earnedDay + earnedNight
	var eRegDay, eRegNight, eOT float64
	if earnedWeekday > 0 {
		eOT = earnedOT
		eRegDay = earnedDay * (1 - earnedOT/earnedWeekday)
		eRegNight = earnedNight * (1 - earnedOT/earnedWeekday)
	}

	cur := rates.CurrencyCode

	// ── Projected earnings (all shifts) ─────────────────────────────────────
	projDayEarn := int64(math.Round(regDay * float64(rates.DayRateCents)))
	projNightEarn := int64(math.Round(regNight * float64(rates.NightRateCents)))
	projWeekendEarn := int64(math.Round(totalWeekend * float64(rates.WeekendRateCents)))
	projOTEarn := int64(math.Round(otHours * float64(rates.OvertimeRateCents)))
	projTotal := projDayEarn + projNightEarn + projWeekendEarn + projOTEarn

	// ── Earned to date (completed shifts only) ───────────────────────────────
	earnDayEarn := int64(math.Round(eRegDay * float64(rates.DayRateCents)))
	earnNightEarn := int64(math.Round(eRegNight * float64(rates.NightRateCents)))
	earnWeekendEarn := int64(math.Round(earnedWeekend * float64(rates.WeekendRateCents)))
	earnOTEarn := int64(math.Round(eOT * float64(rates.OvertimeRateCents)))
	earnedTotal := earnDayEarn + earnNightEarn + earnWeekendEarn + earnOTEarn

	return &payrollv1.PayPreview{
		EmployeeId:        req.EmployeeId,
		PeriodStart:       periodStart.Format("2006-01-02"),
		PeriodEnd:         periodEnd.Format("2006-01-02"),
		RegularDayHours:   roundHours(regDay),
		RegularNightHours: roundHours(regNight),
		WeekendHours:      roundHours(totalWeekend),
		OvertimeHours:     roundHours(otHours),
		DayEarnings:       &commonv1.Money{Amount: projDayEarn, CurrencyCode: cur},
		NightEarnings:     &commonv1.Money{Amount: projNightEarn, CurrencyCode: cur},
		WeekendEarnings:   &commonv1.Money{Amount: projWeekendEarn, CurrencyCode: cur},
		OvertimeEarnings:  &commonv1.Money{Amount: projOTEarn, CurrencyCode: cur},
		EarnedToDate:      &commonv1.Money{Amount: earnedTotal, CurrencyCode: cur},
		ProjectedTotal:    &commonv1.Money{Amount: projTotal, CurrencyCode: cur},
		CompletedShifts:   completedCount,
		ScheduledShifts:   scheduledCount,
	}, nil
}

// ---------------------------------------------------------------------------
// Pay-calculation helpers
// ---------------------------------------------------------------------------

// categoriseShiftHours splits a shift into day, night, and weekend hours.
// Day   = weekday 06:00–18:00 UTC
// Night = weekday 18:00–06:00 UTC
// Weekend = Saturday & Sunday (all hours)
func categoriseShiftHours(start, end time.Time) (day, night, weekend float64) {
	if !end.After(start) {
		return
	}
	// Collect all rate-boundary timestamps between start and end.
	boundaries := rateBoundaries(start, end)
	for i := 0; i < len(boundaries)-1; i++ {
		segStart := boundaries[i]
		segEnd := boundaries[i+1]
		hours := segEnd.Sub(segStart).Hours()
		// Use midpoint to determine the bucket (avoids boundary ambiguity).
		mid := segStart.Add(segEnd.Sub(segStart) / 2)
		wd := mid.Weekday()
		if wd == time.Saturday || wd == time.Sunday {
			weekend += hours
		} else if mid.Hour() >= 6 && mid.Hour() < 18 {
			day += hours
		} else {
			night += hours
		}
	}
	return
}

// rateBoundaries returns the sorted set of rate-change timestamps within
// [start, end], including the endpoints themselves.
// Boundaries are: 00:00, 06:00, 18:00 each UTC day.
func rateBoundaries(start, end time.Time) []time.Time {
	pts := []time.Time{start}
	// Walk day by day, emitting 06:00 and 18:00 boundaries.
	day := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
	for !day.After(end) {
		for _, h := range []int{0, 6, 18} {
			b := day.Add(time.Duration(h) * time.Hour)
			if b.After(start) && b.Before(end) {
				pts = append(pts, b)
			}
		}
		day = day.AddDate(0, 0, 1)
	}
	pts = append(pts, end)
	sort.Slice(pts, func(i, j int) bool { return pts[i].Before(pts[j]) })
	// Deduplicate.
	out := pts[:1]
	for _, p := range pts[1:] {
		if !p.Equal(out[len(out)-1]) {
			out = append(out, p)
		}
	}
	return out
}

// payWeekKey identifies an ISO calendar week.
type payWeekKey struct{ year, week int }

// payWeekHours accumulates day and night weekday hours for one ISO week.
type payWeekHours struct{ day, night float64 }

// overtimeFromBuckets sums the weekly hours that exceed the threshold.
func overtimeFromBuckets(buckets map[payWeekKey]*payWeekHours, threshold float64) float64 {
	var total float64
	for _, wh := range buckets {
		weekday := wh.day + wh.night
		if weekday > threshold {
			total += weekday - threshold
		}
	}
	return total
}

// roundHours rounds to 2 decimal places for clean output.
func roundHours(h float64) float64 {
	return math.Round(h*100) / 100
}

// ---------------------------------------------------------------------------
// scanPayRates — scan a single row into a PayRates proto message.
// ---------------------------------------------------------------------------

type payRatesScanner interface {
	Scan(dest ...any) error
}

func scanPayRates(row payRatesScanner) (*payrollv1.PayRates, error) {
	var pr payrollv1.PayRates
	var thresholdF float64
	err := row.Scan(
		&pr.Id, &pr.EmployeeId, &pr.CurrencyCode,
		&pr.DayRateCents, &pr.NightRateCents, &pr.WeekendRateCents, &pr.OvertimeRateCents,
		&thresholdF, &pr.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	pr.OvertimeThresholdHours = thresholdF
	return &pr, nil
}

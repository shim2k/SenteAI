export function generateReminderId(reminderText: string): string {
    return reminderText.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
}  